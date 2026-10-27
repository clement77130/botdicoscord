import { createHash, randomBytes } from 'crypto';
import type { ChatInputCommandInteraction } from 'discord.js';
import { prisma } from './prisma';

export interface OAuthConfig {
  publicUrl: string;
  host: string;
  port: number;
  discordClientId: string;
  discordClientSecret: string;
  robloxClientId: string;
  robloxClientSecret: string;
}

export const SESSION_TTL_MS = 10 * 60 * 1000;

// Renvoie null tant que les variables d'environnement OAuth ne sont pas toutes renseignées
export function getOAuthConfig(): OAuthConfig | null {
  const env = process.env;
  const publicUrl = env.PUBLIC_URL?.trim().replace(/\/+$/, '');

  if (!publicUrl || !env.CLIENT_ID || !env.DISCORD_CLIENT_SECRET || !env.ROBLOX_CLIENT_ID || !env.ROBLOX_CLIENT_SECRET) {
    return null;
  }

  return {
    publicUrl,
    host: env.WEB_HOST?.trim() || '127.0.0.1',
    port: Number(env.WEB_PORT) || 3000,
    discordClientId: env.CLIENT_ID,
    discordClientSecret: env.DISCORD_CLIENT_SECRET,
    robloxClientId: env.ROBLOX_CLIENT_ID,
    robloxClientSecret: env.ROBLOX_CLIENT_SECRET
  };
}

// Interactions /verify en attente, pour mettre à jour le message d'origine quand le lien est terminé
export const pendingInteractions = new Map<string, ChatInputCommandInteraction>();

export async function createSession(discordId: string, guildId: string) {
  // Nettoyage opportuniste des sessions expirées
  await prisma.robloxOAuthSession.deleteMany({ where: { expiresAt: { lt: new Date() } } });

  return prisma.robloxOAuthSession.create({
    data: {
      id: randomBytes(32).toString('hex'),
      discordId,
      guildId,
      codeVerifier: randomBytes(48).toString('base64url'),
      expiresAt: new Date(Date.now() + SESSION_TTL_MS)
    }
  });
}

export function pkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

const q = encodeURIComponent;

export function buildDiscordAuthUrl(config: OAuthConfig, state: string): string {
  return (
    'https://discord.com/oauth2/authorize' +
    `?client_id=${q(config.discordClientId)}` +
    '&response_type=code' +
    `&redirect_uri=${q(`${config.publicUrl}/callback/discord`)}` +
    '&scope=identify' +
    `&state=${q(state)}`
  );
}

export function buildRobloxAuthUrl(config: OAuthConfig, state: string, verifier: string): string {
  return (
    'https://apis.roblox.com/oauth/v1/authorize' +
    `?client_id=${q(config.robloxClientId)}` +
    `&redirect_uri=${q(`${config.publicUrl}/callback/roblox`)}` +
    '&scope=openid%20profile' +
    '&response_type=code' +
    `&state=${q(state)}` +
    `&code_challenge=${q(pkceChallenge(verifier))}` +
    '&code_challenge_method=S256'
  );
}
