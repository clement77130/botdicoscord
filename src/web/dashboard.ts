import { IncomingMessage, ServerResponse } from 'http';
import { randomBytes } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import { Client } from 'discord.js';
import { prisma } from '../utils/prisma';
import { OAuthConfig, buildDiscordAuthUrl } from '../utils/robloxOAuth';
import {
  HttpError,
  buildCookie,
  clearCookie,
  parseCookies,
  readJsonBody,
  redirect,
  renderPage,
  send,
  sendJson
} from './http';
import { fetchDiscordIdentity } from './discordAuth';
import { routeApi } from './api';

const SESSION_COOKIE = 'ats_dash';
const STATE_COOKIE = 'ats_dstate';
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

// public/ est à la racine du projet (même chemin depuis src/web avec ts-node et depuis dist/web une fois compilé)
const PUBLIC_DIR = path.join(__dirname, '..', '..', 'public');

const ASSETS: Record<string, string> = {
  'dashboard.js': 'application/javascript; charset=utf-8',
  'dashboard.css': 'text/css; charset=utf-8'
};

const PAGE_CSP =
  "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data: https://cdn.discordapp.com https://*.rbxcdn.com; connect-src 'self'; " +
  "frame-ancestors 'none'; base-uri 'none'; form-action 'self'";

export interface DashboardUser {
  sessionId: string;
  id: string;
  username: string;
  avatar: string | null;
}

async function getDashboardUser(req: IncomingMessage): Promise<DashboardUser | null> {
  const id = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (!id || !/^[a-f0-9]{64}$/.test(id)) return null;

  const session = await prisma.dashboardSession.findUnique({ where: { id } });
  if (!session) return null;
  if (session.expiresAt.getTime() < Date.now()) {
    await prisma.dashboardSession.delete({ where: { id } }).catch(() => {});
    return null;
  }
  return { sessionId: session.id, id: session.discordId, username: session.username, avatar: session.avatar };
}

// Fin de la connexion Discord du panel : crée la session et pose le cookie
export async function completeDashboardLogin(
  req: IncomingMessage,
  res: ServerResponse,
  config: OAuthConfig,
  state: string,
  code: string
) {
  const secure = config.publicUrl.startsWith('https://');
  const nonce = state.slice(2);

  if (!nonce || parseCookies(req.headers.cookie)[STATE_COOKIE] !== nonce) {
    return send(res, 400, renderPage('Connexion invalide', 'La session de connexion a expiré. Retournez sur le panel et réessayez.', false));
  }

  const me = await fetchDiscordIdentity(config, code);

  await prisma.dashboardSession.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  const session = await prisma.dashboardSession.create({
    data: {
      id: randomBytes(32).toString('hex'),
      discordId: me.id,
      username: me.global_name || me.username,
      avatar: me.avatar ?? null,
      expiresAt: new Date(Date.now() + SESSION_TTL_SECONDS * 1000)
    }
  });

  return redirect(res, '/dashboard', {
    'Set-Cookie': [
      buildCookie(SESSION_COOKIE, session.id, SESSION_TTL_SECONDS, secure),
      clearCookie(STATE_COOKIE, secure)
    ]
  });
}

async function serveFile(res: ServerResponse, file: string, contentType: string, extraHeaders: Record<string, string> = {}) {
  try {
    const content = await fs.readFile(path.join(PUBLIC_DIR, file));
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      ...extraHeaders
    });
    res.end(content);
  } catch {
    send(res, 404, renderPage('Fichier introuvable', 'Les fichiers du panel (dossier public/) sont absents du serveur.', false));
  }
}

// Renvoie true si la requête concerne le panel (et a donc été traitée)
export async function handleDashboard(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  client: Client,
  config: OAuthConfig
): Promise<boolean> {
  const secure = config.publicUrl.startsWith('https://');
  const method = req.method ?? 'GET';

  // ───── Pages et fichiers statiques ─────
  if (url.pathname === '/dashboard' || url.pathname === '/dashboard/') {
    if (method !== 'GET') {
      send(res, 405, renderPage('Méthode non autorisée', 'GET uniquement.', false));
      return true;
    }
    await serveFile(res, 'dashboard.html', 'text/html; charset=utf-8', { 'Content-Security-Policy': PAGE_CSP });
    return true;
  }

  if (url.pathname === '/dashboard/login') {
    const nonce = randomBytes(16).toString('hex');
    redirect(res, buildDiscordAuthUrl(config, `d.${nonce}`), {
      'Set-Cookie': buildCookie(STATE_COOKIE, nonce, 600, secure)
    });
    return true;
  }

  const asset = url.pathname.match(/^\/dashboard\/assets\/([a-z.]+)$/);
  if (asset) {
    const type = ASSETS[asset[1]];
    if (!type) {
      send(res, 404, renderPage('Fichier introuvable', 'Ce fichier n\'existe pas.', false));
    } else {
      await serveFile(res, asset[1], type);
    }
    return true;
  }

  if (!url.pathname.startsWith('/api/')) return false;

  // ───── API ─────
  try {
    const user = await getDashboardUser(req);
    if (!user) throw new HttpError(401, 'Non connecté');

    // Protection CSRF : les requêtes qui modifient des données doivent venir du panel lui-même
    let body: any = {};
    if (method !== 'GET') {
      if (req.headers.origin !== new URL(config.publicUrl).origin || req.headers['x-requested-with'] !== 'dashboard') {
        throw new HttpError(403, 'Origine non autorisée');
      }
      body = await readJsonBody(req);
    }

    if (method === 'POST' && url.pathname === '/api/logout') {
      await prisma.dashboardSession.delete({ where: { id: user.sessionId } }).catch(() => {});
      res.setHeader('Set-Cookie', clearCookie(SESSION_COOKIE, secure));
      sendJson(res, 200, { ok: true });
      return true;
    }

    const data = await routeApi({ client, config, user, url, method, body });
    sendJson(res, 200, data ?? { ok: true });
  } catch (error) {
    if (error instanceof HttpError) {
      sendJson(res, error.status, { error: error.message });
    } else {
      console.error('❌ Erreur de l\'API du panel:', error);
      sendJson(res, 500, { error: 'Erreur interne du serveur' });
    }
  }
  return true;
}
