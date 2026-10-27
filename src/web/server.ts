import http, { IncomingMessage, ServerResponse } from 'http';
import { randomBytes } from 'crypto';
import { Client, EmbedBuilder } from 'discord.js';
import { prisma } from '../utils/prisma';
import {
  OAuthConfig,
  buildDiscordAuthUrl,
  buildRobloxAuthUrl,
  createSession,
  pendingInteractions,
  SESSION_TTL_MS
} from '../utils/robloxOAuth';
import { updateMember } from '../utils/robloxSync';
import { buildUpdateEmbed, summarizeUpdate } from '../utils/robloxEmbeds';
import { logRobloxAudit } from '../utils/robloxAudit';
import { buildCookie, clearCookie, fetchJson, parseCookies, redirect, renderPage, send } from './http';
import { completeDashboardLogin, handleDashboard } from './dashboard';
import { fetchDiscordIdentity } from './discordAuth';

const COOKIE_NAME = 'ats_sid';
const VERIFY_STATE_COOKIE = 'ats_vstate';

async function getValidSession(id: string | null | undefined) {
  if (!id || !/^[a-f0-9]{64}$/.test(id)) return null;
  const session = await prisma.robloxOAuthSession.findUnique({ where: { id } });
  if (!session) return null;
  if (session.expiresAt.getTime() < Date.now()) {
    await prisma.robloxOAuthSession.delete({ where: { id } }).catch(() => {});
    return null;
  }
  return session;
}

const EXPIRED = 'Ce lien a expiré ou a déjà été utilisé. Retournez sur Discord et relancez /verify.';

async function handleRequest(req: IncomingMessage, res: ServerResponse, client: Client, config: OAuthConfig) {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const secure = config.publicUrl.startsWith('https://');
  const cookies = parseCookies(req.headers.cookie);

  if (url.pathname === '/health') return send(res, 200, 'ok');
  if (url.pathname === '/favicon.ico') {
    res.writeHead(204);
    return res.end();
  }

  // Panel de configuration (pages, fichiers statiques et API)
  if (url.pathname === '/dashboard' || url.pathname.startsWith('/dashboard/') || url.pathname.startsWith('/api/')) {
    if (await handleDashboard(req, res, url, client, config)) return;
  }

  if (req.method !== 'GET') {
    return send(res, 405, renderPage('Méthode non autorisée', 'Cette page n\'accepte que les requêtes GET.', false));
  }

  // Arrivée depuis le bouton « Lier mon compte » de l'embed du serveur : connexion Discord d'abord
  if (url.pathname === '/verify/start') {
    const guildId = url.searchParams.get('guild') ?? '';
    if (!/^\d{5,25}$/.test(guildId) || !client.guilds.cache.has(guildId)) {
      return send(res, 400, renderPage('Serveur inconnu', 'Ce lien ne correspond à aucun serveur où le bot est présent.', false));
    }
    const nonce = randomBytes(16).toString('hex');
    return redirect(res, buildDiscordAuthUrl(config, `s.${guildId}.${nonce}`), {
      'Set-Cookie': buildCookie(VERIFY_STATE_COOKIE, nonce, 600, secure)
    });
  }

  // Arrivée depuis /verify : on pose le cookie qui lie ce navigateur à la session, puis connexion Discord
  const start = url.pathname.match(/^\/verify\/([a-f0-9]{64})$/);
  if (start) {
    const session = await getValidSession(start[1]);
    if (!session) return send(res, 400, renderPage('Lien expiré', EXPIRED, false));

    return redirect(res, buildDiscordAuthUrl(config, session.id), {
      'Set-Cookie': buildCookie(COOKIE_NAME, session.id, Math.floor(SESSION_TTL_MS / 1000), secure)
    });
  }

  // Retour de Discord (connexion au panel, bouton de l'embed, ou /verify)
  if (url.pathname === '/callback/discord') {
    const state = url.searchParams.get('state') ?? '';
    const code = url.searchParams.get('code');

    if (url.searchParams.get('error') || !code) {
      return send(res, 400, renderPage('Connexion annulée', 'La connexion Discord a été annulée. Recommencez depuis Discord.', false));
    }

    // Connexion au panel
    if (state.startsWith('d.')) {
      return completeDashboardLogin(req, res, config, state, code);
    }

    // Bouton « Lier mon compte » : la session est créée ici, avec l'identité Discord vérifiée
    if (state.startsWith('s.')) {
      const [, guildId, nonce] = state.split('.');
      if (!guildId || !nonce || cookies[VERIFY_STATE_COOKIE] !== nonce) {
        return send(res, 400, renderPage('Lien invalide', EXPIRED, false));
      }

      const me = await fetchDiscordIdentity(config, code);
      const guild = client.guilds.cache.get(guildId);
      const member = guild ? await guild.members.fetch(me.id).catch(() => null) : null;
      if (!guild || !member) {
        return send(res, 403, renderPage('Serveur introuvable', 'Vous devez être membre du serveur pour lier votre compte.', false));
      }

      const session = await createSession(me.id, guildId);
      await prisma.robloxOAuthSession.update({ where: { id: session.id }, data: { discordOk: true } });

      return redirect(res, buildRobloxAuthUrl(config, session.id, session.codeVerifier), {
        'Set-Cookie': [
          buildCookie(COOKIE_NAME, session.id, Math.floor(SESSION_TTL_MS / 1000), secure),
          clearCookie(VERIFY_STATE_COOKIE, secure)
        ]
      });
    }

    // /verify : on vérifie que le navigateur est bien celui du membre, puis connexion Roblox
    const session = await getValidSession(state);
    if (!session || cookies[COOKIE_NAME] !== session.id) {
      return send(res, 400, renderPage('Lien invalide', EXPIRED, false));
    }

    const me = await fetchDiscordIdentity(config, code);
    if (me.id !== session.discordId) {
      return send(res, 403, renderPage(
        'Mauvais compte Discord',
        'Vous êtes connecté à Discord avec un autre compte que celui qui a lancé /verify. Reconnectez-vous avec le bon compte.',
        false
      ));
    }

    await prisma.robloxOAuthSession.update({ where: { id: session.id }, data: { discordOk: true } });
    return redirect(res, buildRobloxAuthUrl(config, session.id, session.codeVerifier));
  }

  // Retour de Roblox : on récupère l'identité Roblox et on crée le lien
  if (url.pathname === '/callback/roblox') {
    const state = url.searchParams.get('state');
    const code = url.searchParams.get('code');

    if (url.searchParams.get('error') || !code) {
      return send(res, 400, renderPage('Connexion annulée', 'La connexion Roblox a été annulée. Relancez /verify pour recommencer.', false));
    }

    const session = await getValidSession(state);
    if (!session || !session.discordOk || cookies[COOKIE_NAME] !== session.id) {
      return send(res, 400, renderPage('Lien invalide', EXPIRED, false));
    }

    // À usage unique : la session est consommée avant tout appel externe
    const consumed = await prisma.robloxOAuthSession.deleteMany({ where: { id: session.id } });
    if (consumed.count === 0) return send(res, 400, renderPage('Lien invalide', EXPIRED, false));

    const token = await fetchJson<{ access_token: string }>('https://apis.roblox.com/oauth/v1/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: config.robloxClientId,
        client_secret: config.robloxClientSecret,
        grant_type: 'authorization_code',
        code,
        redirect_uri: `${config.publicUrl}/callback/roblox`,
        code_verifier: session.codeVerifier
      }).toString()
    });

    const roblox = await fetchJson<{ sub: string; preferred_username?: string; name?: string }>(
      'https://apis.roblox.com/oauth/v1/userinfo',
      { headers: { Authorization: `Bearer ${token.access_token}` } }
    );

    const robloxUsername = roblox.preferred_username ?? roblox.name ?? roblox.sub;

    await prisma.robloxLink.upsert({
      where: { discordId: session.discordId },
      create: { discordId: session.discordId, robloxId: roblox.sub, robloxUsername },
      update: { robloxId: roblox.sub, robloxUsername, linkedAt: new Date() }
    });

    // Rôles + pseudo, puis mise à jour du message Discord d'origine
    const embeds = [
      new EmbedBuilder().setColor('#00b06f').setTitle('✅ Compte vérifié').setDescription(`Votre compte Discord est maintenant lié à **${robloxUsername}**.`)
    ];

    try {
      const guild = client.guilds.cache.get(session.guildId);
      const member = guild ? await guild.members.fetch(session.discordId).catch(() => null) : null;
      if (guild && member) {
        const result = await updateMember(member);
        embeds.push(buildUpdateEmbed(result, '🔄 Rôles et pseudo mis à jour'));
        const summary = summarizeUpdate(result);
        await logRobloxAudit(
          guild,
          'Compte vérifié',
          `<@${session.discordId}> lié à ${robloxUsername}${summary ? ' — ' + summary : ''}`,
          { id: session.discordId, name: member.user.username }
        );
      }
    } catch (error) {
      console.error('❌ Mise à jour après liaison OAuth échouée:', error);
      embeds[0].setFooter({ text: 'Compte lié, mais la mise à jour des rôles a échoué. Utilisez /update.' });
    }

    const interaction = pendingInteractions.get(session.id);
    pendingInteractions.delete(session.id);
    await interaction?.editReply({ content: '', embeds, components: [] }).catch(() => {});

    return send(res, 200, renderPage('Compte vérifié', `Votre compte Discord est lié à ${robloxUsername}. Vous pouvez fermer cette page et retourner sur Discord.`, true));
  }

  return send(res, 404, renderPage('Page introuvable', 'Cette page n\'existe pas.', false));
}

export function startWebServer(client: Client, config: OAuthConfig) {
  const server = http.createServer((req, res) => {
    handleRequest(req, res, client, config).catch(error => {
      console.error('❌ Erreur du serveur web:', error);
      if (!res.headersSent) {
        send(res, 500, renderPage('Erreur', 'Une erreur est survenue. Réessayez dans quelques instants.', false));
      } else {
        res.end();
      }
    });
  });

  server.on('error', error => console.error('❌ Impossible de démarrer le serveur web:', error));
  server.listen(config.port, config.host, () => {
    console.log(`🌐 Serveur web sur http://${config.host}:${config.port} (public : ${config.publicUrl})`);
  });
}
