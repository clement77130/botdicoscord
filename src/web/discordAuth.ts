import { OAuthConfig } from '../utils/robloxOAuth';
import { fetchJson } from './http';

interface DiscordIdentity {
  id: string;
  username: string;
  global_name?: string | null;
  avatar?: string | null;
}

// Échange le code OAuth Discord contre l'identité du membre connecté
export async function fetchDiscordIdentity(config: OAuthConfig, code: string): Promise<DiscordIdentity> {
  const token = await fetchJson<{ access_token: string }>('https://discord.com/api/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.discordClientId,
      client_secret: config.discordClientSecret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: `${config.publicUrl}/callback/discord`
    }).toString()
  });

  return fetchJson<DiscordIdentity>('https://discord.com/api/users/@me', {
    headers: { Authorization: `Bearer ${token.access_token}` }
  });
}

