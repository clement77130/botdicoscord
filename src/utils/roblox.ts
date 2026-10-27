import { randomInt } from 'crypto';

const TIMEOUT_MS = 8000;

export class RobloxApiError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
    this.name = 'RobloxApiError';
  }
}

export interface RobloxUser {
  id: number;
  name: string;
  displayName: string;
  description?: string;
  isBanned?: boolean;
  created?: string;
}

export interface RobloxGroupMembership {
  groupName: string;
  roleName: string;
  rank: number;
}

interface FetchOptions {
  method?: string;
  body?: string;
}

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

// Retourne null sur un 404, lève RobloxApiError sinon. Réessaie 2 fois en cas de rate limit (429).
async function robloxFetch<T>(url: string, options: FetchOptions = {}, attempt = 0): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: options.method ?? 'GET',
      body: options.body,
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' }
    });

    if (response.status === 404) return null;

    if (response.status === 429 && attempt < 2) {
      const retryAfter = Number(response.headers.get('retry-after'));
      await sleep(Math.min(retryAfter > 0 ? retryAfter * 1000 : 1500, 5000));
      return robloxFetch<T>(url, options, attempt + 1);
    }

    if (!response.ok) {
      throw new RobloxApiError(`L'API Roblox a répondu avec le code ${response.status}`, response.status);
    }

    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof RobloxApiError) throw error;
    throw new RobloxApiError('Impossible de contacter l\'API Roblox pour le moment');
  } finally {
    clearTimeout(timer);
  }
}

// Petit cache pour ménager l'API (plusieurs /update d'affilée, synchronisations de masse)
const groupsCache = new Map<string, { expires: number; value: Map<string, RobloxGroupMembership> }>();
const GROUPS_TTL_MS = 30_000;

export async function getUserByUsername(username: string): Promise<{ id: number; name: string; displayName: string } | null> {
  try {
    const data = await robloxFetch<{ data: { id: number; name: string; displayName: string }[] }>(
      'https://users.roblox.com/v1/usernames/users',
      { method: 'POST', body: JSON.stringify({ usernames: [username], excludeBannedUsers: false }) }
    );
    return data?.data?.[0] ?? null;
  } catch (error) {
    // Pseudo invalide (trop court, caractères interdits…) : l'API répond 400
    if (error instanceof RobloxApiError && error.status === 400) return null;
    throw error;
  }
}

export async function getUser(robloxId: string | number): Promise<RobloxUser | null> {
  return robloxFetch<RobloxUser>(`https://users.roblox.com/v1/users/${robloxId}`);
}

// Map groupId -> rôle de l'utilisateur dans ce groupe (les groupes dont il n'est pas membre sont absents)
export async function getUserGroups(robloxId: string | number): Promise<Map<string, RobloxGroupMembership>> {
  const key = String(robloxId);
  const cached = groupsCache.get(key);
  if (cached && cached.expires > Date.now()) return cached.value;

  const data = await robloxFetch<{
    data: { group: { id: number; name: string }; role: { name: string; rank: number } }[];
  }>(`https://groups.roblox.com/v2/users/${robloxId}/groups/roles`);

  const result = new Map<string, RobloxGroupMembership>();
  for (const entry of data?.data ?? []) {
    result.set(String(entry.group.id), {
      groupName: entry.group.name,
      roleName: entry.role.name,
      rank: entry.role.rank
    });
  }

  groupsCache.set(key, { expires: Date.now() + GROUPS_TTL_MS, value: result });
  return result;
}

export async function getGroup(groupId: string | number): Promise<{ id: number; name: string } | null> {
  return robloxFetch<{ id: number; name: string }>(`https://groups.roblox.com/v1/groups/${groupId}`);
}

export async function getHeadshot(robloxId: string | number): Promise<string | null> {
  try {
    const data = await robloxFetch<{ data: { state: string; imageUrl: string | null }[] }>(
      `https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${robloxId}&size=150x150&format=Png&isCircular=false`
    );
    const entry = data?.data?.[0];
    return entry && entry.state === 'Completed' ? entry.imageUrl : null;
  } catch {
    return null;
  }
}

const WORDS = [
  'pomme', 'nuage', 'tigre', 'lune', 'soleil', 'rocher', 'ocean', 'foret', 'renard', 'plume',
  'orage', 'bambou', 'cactus', 'dragon', 'etoile', 'falaise', 'galaxie', 'hibou', 'iceberg', 'jungle',
  'koala', 'lagon', 'miroir', 'nectar', 'olivier', 'panda', 'quartz', 'rivage', 'saphir', 'tulipe',
  'volcan', 'zebre', 'cerise', 'dune', 'eclair', 'fusee', 'glacier', 'horizon', 'ivoire', 'jasmin'
];

// Code à 6 mots à coller dans la description du profil Roblox
export function generateVerificationCode(): string {
  return Array.from({ length: 6 }, () => WORDS[randomInt(WORDS.length)]).join(' ');
}

export function normalizeText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

// ───── Fonctions utilisées par le panel et les binds avancés ─────

export type RobloxItemType = 'Asset' | 'Badge' | 'GamePass';

// Possession d'un objet, d'un badge ou d'un gamepass (l'endpoint ignore la confidentialité de l'inventaire)
const ownershipCache = new Map<string, { expires: number; value: boolean }>();

export async function ownsItem(robloxId: string | number, type: RobloxItemType, itemId: string | number): Promise<boolean> {
  const key = `${robloxId}:${type}:${itemId}`;
  const cached = ownershipCache.get(key);
  if (cached && cached.expires > Date.now()) return cached.value;

  const result = await robloxFetch<boolean>(`https://inventory.roblox.com/v1/users/${robloxId}/items/${type}/${itemId}/is-owned`);
  const value = result === true;
  ownershipCache.set(key, { expires: Date.now() + 30_000, value });
  return value;
}

export interface RobloxGroupRole {
  id: number;
  name: string;
  rank: number;
}

export async function getGroupRoles(groupId: string | number): Promise<RobloxGroupRole[] | null> {
  const data = await robloxFetch<{ roles: { id: number; name: string; rank: number }[] }>(
    `https://groups.roblox.com/v1/groups/${groupId}/roles`
  );
  if (!data) return null;
  return data.roles.map(r => ({ id: r.id, name: r.name, rank: r.rank })).sort((a, b) => a.rank - b.rank);
}

export interface RobloxGroupInfo {
  id: string;
  name: string;
  icon: string | null;
}

const groupInfoCache = new Map<string, { expires: number; value: RobloxGroupInfo }>();
const GROUP_INFO_TTL_MS = 10 * 60 * 1000;

// Nom et icône de plusieurs groupes (cache de 10 minutes). Les groupes introuvables sont simplement absents.
export async function getGroupsInfo(ids: string[]): Promise<Record<string, RobloxGroupInfo>> {
  const result: Record<string, RobloxGroupInfo> = {};
  const missing: string[] = [];

  for (const id of [...new Set(ids)].filter(i => /^\d{1,12}$/.test(i)).slice(0, 50)) {
    const cached = groupInfoCache.get(id);
    if (cached && cached.expires > Date.now()) result[id] = cached.value;
    else missing.push(id);
  }

  if (missing.length) {
    const list = missing.join(',');
    const [names, icons] = await Promise.all([
      robloxFetch<{ data: { id: number; name: string }[] }>(`https://groups.roblox.com/v2/groups?groupIds=${list}`).catch(() => null),
      robloxFetch<{ data: { targetId: number; state: string; imageUrl: string | null }[] }>(
        `https://thumbnails.roblox.com/v1/groups/icons?groupIds=${list}&size=150x150&format=Png&isCircular=false`
      ).catch(() => null)
    ]);

    for (const entry of names?.data ?? []) {
      const icon = icons?.data.find(i => i.targetId === entry.id && i.state === 'Completed')?.imageUrl ?? null;
      const info = { id: String(entry.id), name: entry.name, icon };
      groupInfoCache.set(info.id, { expires: Date.now() + GROUP_INFO_TTL_MS, value: info });
      result[info.id] = info;
    }
  }

  return result;
}
