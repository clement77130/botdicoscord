import { Guild, GuildMember } from 'discord.js';
import type { RobloxBind, RobloxConfig, RobloxDenylist } from '@prisma/client';
import { prisma } from './prisma';
import { getUser, getUserGroups, ownsItem, RobloxApiError, RobloxGroupMembership, RobloxItemType } from './roblox';
import { CustomBindContext, CustomBindError, evaluateCustomBind, parseCustomBind } from './customBind';
import {
  bindKind,
  bindRoleIds,
  bypassRoleIds,
  rankMatches,
  stickyRoleIds,
  unverifiedRoleIds,
  verifiedRoleIds
} from './robloxConfig';
import { logRobloxAudit } from './robloxAudit';

export interface GuildSettings {
  config: RobloxConfig | null;
  binds: RobloxBind[];
  denylists: RobloxDenylist[];
}

export interface UpdateResult {
  linked: boolean;
  robloxId?: string;
  robloxUsername?: string;
  added: string[];
  removed: string[];
  nickname: string | null;
  warnings: string[];
  // Le membre possède un rôle « bypass » : rien n'a été modifié
  bypassed?: boolean;
  // Le compte Roblox est sur la liste de refus du serveur
  denied?: { reason: string; action: 'none' | 'kick' | 'ban' };
}

export async function loadGuildSettings(guildId: string): Promise<GuildSettings> {
  const [config, binds, denylists] = await Promise.all([
    prisma.robloxConfig.findUnique({ where: { guildId } }),
    prisma.robloxBind.findMany({ where: { guildId }, orderBy: { id: 'asc' } }),
    prisma.robloxDenylist.findMany({ where: { guildId }, orderBy: { id: 'asc' } })
  ]);
  return { config, binds, denylists };
}

function isItemType(value: string | null): value is RobloxItemType {
  return value === 'Asset' || value === 'Badge' || value === 'GamePass';
}

function buildContext(robloxId: string, groups: Map<string, RobloxGroupMembership>): CustomBindContext {
  return {
    inGroup: async groupId => groups.has(groupId),
    rank: async groupId => groups.get(groupId)?.rank ?? 0,
    hasItem: (type, id) => ownsItem(robloxId, type, id)
  };
}

async function evaluateCode(code: string | null, ctx: CustomBindContext, warnings: string[]): Promise<boolean> {
  if (!code) return false;
  try {
    return await evaluateCustomBind(parseCustomBind(code), ctx);
  } catch (error) {
    if (error instanceof CustomBindError) {
      warnings.push(`Une condition personnalisée est invalide (${error.message}).`);
      return false;
    }
    throw error;
  }
}

async function bindMatched(
  bind: RobloxBind,
  robloxId: string,
  groups: Map<string, RobloxGroupMembership>,
  ctx: CustomBindContext,
  warnings: string[]
): Promise<boolean> {
  switch (bindKind(bind)) {
    case 'group':
      return groups.has(bind.groupId);
    case 'rank':
      return rankMatches(bind, groups.get(bind.groupId)?.rank ?? 0);
    case 'custom':
      return evaluateCode(bind.code, ctx, warnings);
    case 'asset':
      return bind.assetId && isItemType(bind.assetType) ? ownsItem(robloxId, bind.assetType, bind.assetId) : false;
  }
}

function applyTemplate(template: string, vars: Record<string, string>): string | null {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.split(`{${key}}`).join(value);
  }
  result = result.trim().slice(0, 32);
  return result.length > 0 ? result : null;
}

const SEVERITY: Record<string, number> = { none: 0, kick: 1, ban: 2 };

/**
 * Synchronise rôles et pseudo d'un membre avec son compte Roblox lié.
 * Ne touche qu'aux rôles gérés par le bot (rôles vérifié / non vérifié et rôles des binds),
 * jamais aux rôles « sticky » ni aux membres ayant un rôle « bypass ».
 * Lève RobloxApiError si l'API Roblox est indisponible : dans ce cas aucun rôle n'est retiré.
 */
export async function updateMember(member: GuildMember, preloaded?: GuildSettings): Promise<UpdateResult> {
  const guild = member.guild;
  const { config, binds, denylists } = preloaded ?? (await loadGuildSettings(guild.id));
  const result: UpdateResult = { linked: false, added: [], removed: [], nickname: null, warnings: [] };

  if (bypassRoleIds(config).some(id => member.roles.cache.has(id))) {
    result.bypassed = true;
    result.linked = !!(await prisma.robloxLink.findUnique({ where: { discordId: member.id }, select: { discordId: true } }));
    return result;
  }

  const link = await prisma.robloxLink.findUnique({ where: { discordId: member.id } });
  result.linked = !!link;

  // Rôles gérés par le bot
  const managed = new Set<string>([...verifiedRoleIds(config), ...unverifiedRoleIds(config)]);
  for (const bind of binds) for (const id of bindRoleIds(bind)) managed.add(id);
  const sticky = new Set(stickyRoleIds(config));

  const target = new Set<string>();
  let desiredNickname: string | null = null;

  if (!link) {
    for (const id of unverifiedRoleIds(config)) target.add(id);
  } else {
    const [user, groups] = await Promise.all([getUser(link.robloxId), getUserGroups(link.robloxId)]);
    if (!user) throw new RobloxApiError('Ce compte Roblox est introuvable (supprimé ou banni ?)', 404);

    if (user.name !== link.robloxUsername) {
      await prisma.robloxLink.update({ where: { discordId: member.id }, data: { robloxUsername: user.name } });
    }
    result.robloxId = link.robloxId;
    result.robloxUsername = user.name;

    const ctx = buildContext(link.robloxId, groups);

    // Liste de refus : la sanction la plus sévère l'emporte
    let denial: RobloxDenylist | null = null;
    for (const entry of denylists) {
      let hit = false;
      if (entry.type === 'user') hit = entry.value === link.robloxId;
      else if (entry.type === 'group') hit = groups.has(entry.value);
      else if (entry.type === 'custom') hit = await evaluateCode(entry.value, ctx, result.warnings);
      if (hit && (!denial || (SEVERITY[entry.action] ?? 0) > (SEVERITY[denial.action] ?? 0))) denial = entry;
    }

    if (denial) {
      const action = denial.action === 'ban' || denial.action === 'kick' ? denial.action : 'none';
      const reason = denial.reason || 'Aucune raison précisée';
      result.denied = { reason, action };
      await logRobloxAudit(
        guild,
        'Liste de refus',
        `<@${member.id}> (${user.name}) est sur la liste de refus — action : ${action} — ${reason}`
      );

      try {
        if (action === 'ban' && member.bannable) await member.ban({ reason: `Liste de refus Roblox : ${reason}` });
        else if (action === 'kick' && member.kickable) await member.kick(`Liste de refus Roblox : ${reason}`);
        else if (action !== 'none') result.warnings.push('Je ne peux pas sanctionner ce membre (rôle supérieur au mien).');
      } catch (error) {
        console.error('❌ Sanction de la liste de refus impossible:', error);
        result.warnings.push('La sanction de la liste de refus a échoué.');
      }
      return result;
    }

    for (const id of verifiedRoleIds(config)) target.add(id);

    // Associations correspondantes ; la priorité la plus haute décide du modèle de pseudo
    let best: { bind: RobloxBind; template: string } | null = null;
    for (const bind of binds) {
      if (!(await bindMatched(bind, link.robloxId, groups, ctx, result.warnings))) continue;
      for (const id of bindRoleIds(bind)) target.add(id);
      const template = bind.template?.trim();
      if (template && (!best || bind.priority > best.bind.priority)) best = { bind, template };
    }

    const nameVars = (groupId: string | null | undefined): Record<string, string> => {
      const membership = groupId ? groups.get(groupId) : undefined;
      return {
        'roblox-username': user.name,
        'display-name': user.displayName,
        'smart-name': user.displayName && user.displayName !== user.name ? `${user.displayName} (@${user.name})` : user.name,
        'discord-name': member.user.username,
        'discord-id': member.id,
        'roblox-id': link.robloxId,
        'group-rank': membership?.roleName ?? 'Guest',
        'group-rank-number': String(membership?.rank ?? 0)
      };
    };

    if (best) {
      desiredNickname = applyTemplate(best.template, nameVars(best.bind.groupId || config?.mainGroupId));
    } else if (config?.nicknameTemplate?.trim()) {
      desiredNickname = applyTemplate(config.nicknameTemplate, nameVars(config.mainGroupId));
    }
  }

  // Rôles
  const addable: string[] = [];
  for (const id of target) {
    if (member.roles.cache.has(id)) continue;
    const role = guild.roles.cache.get(id);
    if (!role) result.warnings.push(`Un rôle configuré (${id}) n'existe plus.`);
    else if (!role.editable) result.warnings.push(`Je ne peux pas attribuer **${role.name}** (il est au-dessus de mon rôle).`);
    else addable.push(id);
  }

  const removable: string[] = [];
  for (const id of managed) {
    if (target.has(id) || sticky.has(id) || !member.roles.cache.has(id)) continue;
    const role = guild.roles.cache.get(id);
    if (!role) continue;
    if (!role.editable) result.warnings.push(`Je ne peux pas retirer **${role.name}** (il est au-dessus de mon rôle).`);
    else removable.push(id);
  }

  try {
    if (addable.length) {
      await member.roles.add(addable, 'Synchronisation Roblox');
      result.added = addable;
    }
    if (removable.length) {
      await member.roles.remove(removable, 'Synchronisation Roblox');
      result.removed = removable;
    }
  } catch (error) {
    console.error('❌ Erreur lors de la modification des rôles Roblox:', error);
    result.warnings.push('Erreur lors de la modification des rôles (permission « Gérer les rôles » manquante ?).');
  }

  // Pseudo
  if (desiredNickname && member.nickname !== desiredNickname && member.displayName !== desiredNickname) {
    if (!member.manageable) {
      result.warnings.push('Je ne peux pas modifier le pseudo de ce membre (propriétaire ou rôle supérieur au mien).');
    } else {
      try {
        await member.setNickname(desiredNickname, 'Synchronisation Roblox');
        result.nickname = desiredNickname;
      } catch (error) {
        console.error('❌ Erreur lors du changement de pseudo:', error);
        result.warnings.push('Impossible de modifier le pseudo (permission « Gérer les pseudos » manquante ?).');
      }
    }
  }

  return result;
}

const syncing = new Set<string>();
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

export function isSyncing(guildId: string): boolean {
  return syncing.has(guildId);
}

export interface SyncSummary {
  total: number;
  changed: number;
  failed: number;
}

// Mise à jour de tous les membres d'un serveur, en série pour respecter les limites de l'API Roblox
export async function syncGuild(guild: Guild): Promise<SyncSummary> {
  if (syncing.has(guild.id)) throw new Error('Une synchronisation est déjà en cours sur ce serveur.');

  const settings = await loadGuildSettings(guild.id);
  const summary: SyncSummary = { total: 0, changed: 0, failed: 0 };
  if (!settings.config && settings.binds.length === 0) return summary;

  syncing.add(guild.id);
  try {
    const members = await guild.members.fetch();
    for (const member of members.values()) {
      if (member.user.bot) continue;
      summary.total++;
      try {
        const result = await updateMember(member, settings);
        if (result.added.length || result.removed.length || result.nickname) summary.changed++;
        if (result.linked) await sleep(700);
      } catch (error) {
        summary.failed++;
        if (error instanceof RobloxApiError) await sleep(2000);
      }
    }
  } finally {
    syncing.delete(guild.id);
  }
  return summary;
}
