import type { RobloxBind, RobloxConfig } from '@prisma/client';

// Les listes de rôles sont stockées en JSON dans la base
export function parseIdList(raw: string | null | undefined): string[] {
  try {
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string' && /^\d{5,25}$/.test(id)) : [];
  } catch {
    return [];
  }
}

function union(list: string[], legacy: string | null | undefined): string[] {
  return legacy && !list.includes(legacy) ? [...list, legacy] : list;
}

export function verifiedRoleIds(config: RobloxConfig | null): string[] {
  return config ? union(parseIdList(config.verifiedRoles), config.verifiedRoleId) : [];
}

export function unverifiedRoleIds(config: RobloxConfig | null): string[] {
  return config ? union(parseIdList(config.unverifiedRoles), config.unverifiedRoleId) : [];
}

export function stickyRoleIds(config: RobloxConfig | null): string[] {
  return config ? parseIdList(config.stickyRoles) : [];
}

export function bypassRoleIds(config: RobloxConfig | null): string[] {
  return config ? parseIdList(config.bypassRoles) : [];
}

export function bindRoleIds(bind: Pick<RobloxBind, 'roleIds' | 'roleId'>): string[] {
  return union(parseIdList(bind.roleIds), bind.roleId);
}

// Anciennes associations « groupe sans rang » créées par /bind : tous les membres du groupe
export function bindKind(bind: Pick<RobloxBind, 'type' | 'rank' | 'minRank' | 'maxRank'>): 'rank' | 'group' | 'custom' | 'asset' {
  if (bind.type === 'custom' || bind.type === 'asset' || bind.type === 'group') return bind.type;
  if (bind.rank === null && bind.minRank === null && bind.maxRank === null) return 'group';
  return 'rank';
}

export function rankMatches(bind: Pick<RobloxBind, 'rank' | 'minRank' | 'maxRank'>, rank: number): boolean {
  if (bind.rank !== null) return rank === bind.rank;
  return rank >= (bind.minRank ?? 1) && rank <= (bind.maxRank ?? 255);
}
