import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  EmbedBuilder,
  Guild,
  GuildMember,
  PermissionFlagsBits,
  TextChannel
} from 'discord.js';
import type { RobloxBind } from '@prisma/client';
import { prisma } from '../utils/prisma';
import { OAuthConfig } from '../utils/robloxOAuth';
import { DashboardUser } from './dashboard';
import { HttpError } from './http';
import { getGroup, getGroupRoles, getGroupsInfo, getUserByUsername, RobloxApiError } from '../utils/roblox';
import { validateCustomBind } from '../utils/customBind';
import {
  bindKind,
  bindRoleIds,
  bypassRoleIds,
  parseIdList,
  stickyRoleIds,
  unverifiedRoleIds,
  verifiedRoleIds
} from '../utils/robloxConfig';
import { isSyncing, syncGuild } from '../utils/robloxSync';
import { logRobloxAudit } from '../utils/robloxAudit';
import { sendTicketPanel } from '../utils/ticketPanel';
import { createGiveaway } from '../utils/giveaways';

export interface ApiRequest {
  client: Client;
  config: OAuthConfig;
  user: DashboardUser;
  url: URL;
  method: string;
  body: any;
}

interface Ctx extends ApiRequest {
  params: string[];
  guild: Guild;
  member: GuildMember;
}

type Handler = (c: Ctx) => Promise<unknown>;

interface Route {
  method: string;
  pattern: RegExp;
  guildScoped: boolean;
  handler: Handler;
}

// ───── Validation ─────

const SNOWFLAKE = /^\d{5,25}$/;
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

function text(value: unknown, field: string, max: number, required = false): string {
  if (value === undefined || value === null || value === '') {
    if (required) throw new HttpError(400, `${field} est obligatoire`);
    return '';
  }
  if (typeof value !== 'string') throw new HttpError(400, `${field} est invalide`);
  const trimmed = value.trim();
  if (required && !trimmed) throw new HttpError(400, `${field} est obligatoire`);
  if (trimmed.length > max) throw new HttpError(400, `${field} est trop long (${max} caractères maximum)`);
  return trimmed;
}

function int(value: unknown, field: string, min: number, max: number): number {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < min || n > max) {
    throw new HttpError(400, `${field} doit être un entier entre ${min} et ${max}`);
  }
  return n;
}

function optionalInt(value: unknown, field: string, min: number, max: number): number | null {
  if (value === undefined || value === null || value === '') return null;
  return int(value, field, min, max);
}

function digits(value: unknown, field: string): string {
  const s = typeof value === 'number' ? String(value) : text(value, field, 20, true);
  if (!/^\d{1,15}$/.test(s)) throw new HttpError(400, `${field} doit être un identifiant numérique`);
  return s;
}

function roleList(guild: Guild, value: unknown, field: string, max = 25): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > max) throw new HttpError(400, `${field} est invalide`);
  const ids = [...new Set(value.map(String))];
  for (const id of ids) {
    if (!SNOWFLAKE.test(id) || id === guild.id || !guild.roles.cache.has(id)) {
      throw new HttpError(400, `${field} contient un rôle inconnu`);
    }
  }
  return ids;
}

function channelOrNull(guild: Guild, value: unknown, field: string, types: ChannelType[]): string | null {
  if (value === undefined || value === null || value === '') return null;
  const id = String(value);
  const channel = SNOWFLAKE.test(id) ? guild.channels.cache.get(id) : undefined;
  if (!channel || !types.includes(channel.type)) throw new HttpError(400, `${field} est invalide`);
  return id;
}

function textChannel(guild: Guild, value: unknown, field: string): TextChannel {
  const id = channelOrNull(guild, value, field, [ChannelType.GuildText]);
  if (!id) throw new HttpError(400, `${field} est obligatoire`);
  const channel = guild.channels.cache.get(id) as TextChannel;
  const me = guild.members.me;
  const perms = me ? channel.permissionsFor(me) : null;
  if (!perms?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks])) {
    throw new HttpError(400, 'Le bot ne peut pas écrire dans ce salon (permissions manquantes)');
  }
  return channel;
}

function audit(c: Ctx, action: string, details: string) {
  return logRobloxAudit(c.guild, action, details, { id: c.user.id, name: c.user.username });
}

async function ensureGuildRow(guildId: string) {
  await prisma.guild.upsert({ where: { id: guildId }, create: { id: guildId, moderationRoles: '[]' }, update: {} });
}

// ───── Accès ─────

async function resolveAccess(client: Client, guildId: string, userId: string) {
  const guild = client.guilds.cache.get(guildId);
  if (!guild) throw new HttpError(404, 'Serveur introuvable');

  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) throw new HttpError(403, 'Accès refusé');

  const allowed =
    member.permissions.has(PermissionFlagsBits.Administrator) || member.permissions.has(PermissionFlagsBits.ManageGuild);
  if (!allowed) throw new HttpError(403, 'Il faut la permission « Gérer le serveur » pour utiliser le panel');

  return { guild, member };
}

// ───── Routes ─────

const routes: Route[] = [];
const route = (method: string, pattern: string, guildScoped: boolean, handler: Handler) => {
  routes.push({ method, pattern: new RegExp(`^${pattern}$`), guildScoped, handler });
};

// Liste des serveurs que l'utilisateur peut configurer
route('GET', '/api/me', false, async c => {
  const entries = await Promise.all(
    [...c.client.guilds.cache.values()].slice(0, 100).map(async guild => {
      try {
        await resolveAccess(c.client, guild.id, c.user.id);
        return { id: guild.id, name: guild.name, icon: guild.iconURL({ size: 128 }) };
      } catch {
        return null;
      }
    })
  );

  return {
    user: {
      id: c.user.id,
      username: c.user.username,
      avatar: c.user.avatar ? `https://cdn.discordapp.com/avatars/${c.user.id}/${c.user.avatar}.png?size=64` : null
    },
    guilds: entries.filter(Boolean)
  };
});

route('GET', '/api/guilds/(\\d+)/meta', true, async c => {
  const roles = [...c.guild.roles.cache.values()]
    .filter(r => r.id !== c.guild.id)
    .sort((a, b) => b.position - a.position)
    .map(r => ({
      id: r.id,
      name: r.name,
      color: r.hexColor !== '#000000' ? r.hexColor : null,
      managed: r.managed,
      assignable: r.editable
    }));

  const listedTypes: ChannelType[] = [ChannelType.GuildText, ChannelType.GuildCategory];
  const channels = [...c.guild.channels.cache.values()]
    .filter(ch => listedTypes.includes(ch.type))
    .sort((a, b) => ('rawPosition' in a && 'rawPosition' in b ? a.rawPosition - b.rawPosition : 0))
    .map(ch => ({ id: ch.id, name: ch.name, type: ch.type === ChannelType.GuildCategory ? 'category' : 'text' }));

  return {
    guild: { id: c.guild.id, name: c.guild.name, icon: c.guild.iconURL({ size: 128 }) },
    roles,
    channels,
    publicUrl: c.config.publicUrl
  };
});

// ───── Paramètres généraux ─────

route('GET', '/api/guilds/(\\d+)/general', true, async c => {
  const data = await prisma.guild.findUnique({ where: { id: c.guild.id } });
  return {
    welcomeChannelId: data?.welcomeChannelId ?? null,
    logChannelId: data?.logChannelId ?? null,
    ticketCategoryId: data?.ticketCategoryId ?? null,
    moderationRoles: parseIdList(data?.moderationRoles)
  };
});

route('PUT', '/api/guilds/(\\d+)/general', true, async c => {
  const welcomeChannelId = channelOrNull(c.guild, c.body.welcomeChannelId, 'Le salon de bienvenue', [ChannelType.GuildText]);
  const logChannelId = channelOrNull(c.guild, c.body.logChannelId, 'Le salon de logs', [ChannelType.GuildText]);
  const ticketCategoryId = channelOrNull(c.guild, c.body.ticketCategoryId, 'La catégorie des tickets', [ChannelType.GuildCategory]);
  const moderationRoles = roleList(c.guild, c.body.moderationRoles, 'Les rôles de modération');

  await prisma.guild.upsert({
    where: { id: c.guild.id },
    create: { id: c.guild.id, welcomeChannelId, logChannelId, ticketCategoryId, moderationRoles: JSON.stringify(moderationRoles) },
    update: { welcomeChannelId, logChannelId, ticketCategoryId, moderationRoles: JSON.stringify(moderationRoles) }
  });

  await audit(c, 'Paramètres généraux modifiés (panel)', 'Salons et rôles de modération mis à jour');
  return { welcomeChannelId, logChannelId, ticketCategoryId, moderationRoles };
});

route('POST', '/api/guilds/(\\d+)/tickets/send', true, async c => {
  const channel = textChannel(c.guild, c.body.channelId, 'Le salon');
  const message = await sendTicketPanel(channel);
  await audit(c, 'Message de tickets envoyé (panel)', `Salon : <#${channel.id}>`);
  return { url: message.url };
});

// ───── Roblox : paramètres ─────

async function readRobloxSettings(guildId: string) {
  const config = await prisma.robloxConfig.findUnique({ where: { guildId } });
  return {
    updateOnJoin: config?.autoUpdateOnJoin ?? true,
    autoDetection: config?.autoDetection ?? false,
    unverifiedRoles: unverifiedRoleIds(config),
    verifiedRoles: verifiedRoleIds(config),
    stickyRoles: stickyRoleIds(config),
    bypassRoles: bypassRoleIds(config),
    logChannelId: config?.logChannelId ?? null,
    nicknameTemplate: config?.nicknameTemplate ?? '{roblox-username}',
    mainGroupId: config?.mainGroupId ?? null
  };
}

route('GET', '/api/guilds/(\\d+)/roblox/settings', true, async c => readRobloxSettings(c.guild.id));

route('PUT', '/api/guilds/(\\d+)/roblox/settings', true, async c => {
  const b = c.body;

  let mainGroupId: string | null = null;
  if (b.mainGroupId !== undefined && b.mainGroupId !== null && b.mainGroupId !== '') {
    mainGroupId = digits(b.mainGroupId, 'Le groupe principal');
    try {
      if (!(await getGroup(mainGroupId))) throw new HttpError(400, `Le groupe Roblox ${mainGroupId} est introuvable`);
    } catch (error) {
      if (error instanceof HttpError) throw error;
      // API Roblox indisponible : on enregistre quand même
    }
  }

  const data = {
    autoUpdateOnJoin: b.updateOnJoin === true,
    autoDetection: b.autoDetection === true,
    unverifiedRoles: JSON.stringify(roleList(c.guild, b.unverifiedRoles, 'Les rôles non vérifiés')),
    verifiedRoles: JSON.stringify(roleList(c.guild, b.verifiedRoles, 'Les rôles vérifiés')),
    stickyRoles: JSON.stringify(roleList(c.guild, b.stickyRoles, 'Les rôles persistants')),
    bypassRoles: JSON.stringify(roleList(c.guild, b.bypassRoles, 'Les rôles bypass')),
    logChannelId: channelOrNull(c.guild, b.logChannelId, 'Le salon de logs', [ChannelType.GuildText]),
    nicknameTemplate: text(b.nicknameTemplate, 'Le modèle de pseudo', 100) || '{roblox-username}',
    mainGroupId,
    // Les anciens champs (rôle unique) sont remplacés par les listes
    verifiedRoleId: null,
    unverifiedRoleId: null
  };

  await prisma.robloxConfig.upsert({
    where: { guildId: c.guild.id },
    create: { guildId: c.guild.id, ...data },
    update: data
  });

  await audit(c, 'Paramètres Roblox modifiés (panel)', 'Les paramètres du serveur ont été mis à jour');
  return readRobloxSettings(c.guild.id);
});

// ───── Roblox : binds ─────

const BIND_LIMIT = 500;
const ASSET_TYPES = ['Asset', 'Badge', 'GamePass'];

function serializeBind(b: RobloxBind) {
  return {
    id: b.id,
    type: bindKind(b),
    groupId: b.groupId,
    rank: b.rank,
    minRank: b.minRank,
    maxRank: b.maxRank,
    code: b.code,
    assetId: b.assetId,
    assetType: b.assetType,
    template: b.template,
    priority: b.priority,
    roleIds: bindRoleIds(b)
  };
}

function parseBindBody(c: Ctx) {
  const b = c.body;
  const type = b.type;
  if (!['rank', 'group', 'custom', 'asset'].includes(type)) throw new HttpError(400, 'Type d\'association invalide');

  const roleIds = roleList(c.guild, b.roleIds, 'Les rôles Discord');
  if (roleIds.length === 0) throw new HttpError(400, 'Choisissez au moins un rôle Discord');

  const data = {
    type: type as string,
    groupId: '',
    rank: null as number | null,
    minRank: null as number | null,
    maxRank: null as number | null,
    code: null as string | null,
    assetId: null as string | null,
    assetType: null as string | null,
    template: text(b.template, 'Le modèle de pseudo', 100) || null,
    priority: b.priority === undefined || b.priority === '' || b.priority === null ? 0 : int(b.priority, 'La priorité', -1000, 1000),
    roleIds: JSON.stringify(roleIds)
  };

  if (type === 'rank' || type === 'group') {
    data.groupId = digits(b.groupId, 'Le groupe');
  }

  if (type === 'rank') {
    const rank = int(b.rank, 'Le rang', 0, 255);
    const rankMax = optionalInt(b.rankMax, 'Le rang maximum', 0, 255);
    if (rankMax !== null) {
      if (rankMax < rank) throw new HttpError(400, 'Le rang maximum doit être supérieur ou égal au rang');
      data.minRank = rank;
      data.maxRank = rankMax;
    } else {
      data.rank = rank;
    }
  }

  if (type === 'custom') {
    const code = text(b.code, 'Le code', 500, true);
    const error = validateCustomBind(code);
    if (error) throw new HttpError(400, `Code invalide : ${error}`);
    data.code = code;
  }

  if (type === 'asset') {
    data.assetId = digits(b.assetId, 'L\'identifiant de l\'objet');
    if (!ASSET_TYPES.includes(b.assetType)) throw new HttpError(400, 'Type d\'objet invalide');
    data.assetType = b.assetType;
  }

  return { data, roleIds };
}

function describeBind(data: ReturnType<typeof parseBindBody>['data']): string {
  if (data.type === 'custom') return 'condition personnalisée';
  if (data.type === 'asset') return `${data.assetType} ${data.assetId}`;
  if (data.type === 'group') return `groupe ${data.groupId}`;
  if (data.rank !== null) return `groupe ${data.groupId}, rang ${data.rank}`;
  return `groupe ${data.groupId}, rangs ${data.minRank}–${data.maxRank}`;
}

route('GET', '/api/guilds/(\\d+)/roblox/binds', true, async c => {
  const binds = await prisma.robloxBind.findMany({ where: { guildId: c.guild.id }, orderBy: { id: 'asc' } });
  return { binds: binds.map(serializeBind) };
});

route('POST', '/api/guilds/(\\d+)/roblox/binds', true, async c => {
  const count = await prisma.robloxBind.count({ where: { guildId: c.guild.id } });
  if (count >= BIND_LIMIT) throw new HttpError(400, `Limite de ${BIND_LIMIT} associations atteinte`);

  const { data, roleIds } = parseBindBody(c);
  const bind = await prisma.robloxBind.create({ data: { guildId: c.guild.id, ...data } });
  await audit(c, 'Association créée (panel)', `#${bind.id} — ${describeBind(data)} → ${roleIds.map(id => `<@&${id}>`).join(' ')}`);
  return serializeBind(bind);
});

route('PUT', '/api/guilds/(\\d+)/roblox/binds/(\\d+)', true, async c => {
  const id = Number(c.params[1]);
  const existing = await prisma.robloxBind.findFirst({ where: { id, guildId: c.guild.id } });
  if (!existing) throw new HttpError(404, 'Association introuvable');

  const { data, roleIds } = parseBindBody(c);
  const bind = await prisma.robloxBind.update({ where: { id }, data: { ...data, roleId: null } });
  await audit(c, 'Association modifiée (panel)', `#${id} — ${describeBind(data)} → ${roleIds.map(r => `<@&${r}>`).join(' ')}`);
  return serializeBind(bind);
});

route('POST', '/api/guilds/(\\d+)/roblox/binds/delete', true, async c => {
  if (!Array.isArray(c.body.ids) || c.body.ids.length === 0 || c.body.ids.length > BIND_LIMIT) {
    throw new HttpError(400, 'Aucune association sélectionnée');
  }
  const ids = c.body.ids.map((n: unknown) => int(n, 'Identifiant', 1, 2_000_000_000));
  const result = await prisma.robloxBind.deleteMany({ where: { guildId: c.guild.id, id: { in: ids } } });
  await audit(c, 'Associations supprimées (panel)', `${result.count} association(s) supprimée(s)`);
  return { deleted: result.count };
});

// ───── Roblox : listes de refus ─────

const DENY_ACTIONS = ['none', 'kick', 'ban'];

route('GET', '/api/guilds/(\\d+)/roblox/denylists', true, async c => {
  const items = await prisma.robloxDenylist.findMany({ where: { guildId: c.guild.id }, orderBy: { id: 'asc' } });
  return { denylists: items.map(i => ({ id: i.id, type: i.type, value: i.value, action: i.action, reason: i.reason })) };
});

route('POST', '/api/guilds/(\\d+)/roblox/denylists', true, async c => {
  const b = c.body;
  if (!['user', 'group', 'custom'].includes(b.type)) throw new HttpError(400, 'Type invalide');
  if (!DENY_ACTIONS.includes(b.action)) throw new HttpError(400, 'Action invalide');

  const count = await prisma.robloxDenylist.count({ where: { guildId: c.guild.id } });
  if (count >= BIND_LIMIT) throw new HttpError(400, `Limite de ${BIND_LIMIT} entrées atteinte`);

  let value: string;
  if (b.type === 'user') {
    const raw = text(b.value, 'L\'utilisateur Roblox', 50, true);
    if (/^\d{1,15}$/.test(raw)) {
      value = raw;
    } else {
      // Pseudo Roblox : on le convertit en identifiant
      try {
        const found = await getUserByUsername(raw);
        if (!found) throw new HttpError(400, `Aucun compte Roblox nommé « ${raw} »`);
        value = String(found.id);
      } catch (error) {
        if (error instanceof RobloxApiError) throw new HttpError(502, error.message);
        throw error;
      }
    }
  } else if (b.type === 'group') {
    value = digits(b.value, 'Le groupe');
  } else {
    value = text(b.value, 'Le code', 500, true);
    const error = validateCustomBind(value);
    if (error) throw new HttpError(400, `Code invalide : ${error}`);
  }

  const reason = text(b.reason, 'La raison', 200);
  const item = await prisma.robloxDenylist.create({
    data: { guildId: c.guild.id, type: b.type, value, action: b.action, reason }
  });

  await audit(c, 'Liste de refus modifiée (panel)', `Ajout : ${b.type} ${b.type === 'custom' ? '(condition)' : value} — action ${b.action}`);
  return { id: item.id, type: item.type, value: item.value, action: item.action, reason: item.reason };
});

route('POST', '/api/guilds/(\\d+)/roblox/denylists/delete', true, async c => {
  if (!Array.isArray(c.body.ids) || c.body.ids.length === 0 || c.body.ids.length > BIND_LIMIT) {
    throw new HttpError(400, 'Aucune entrée sélectionnée');
  }
  const ids = c.body.ids.map((n: unknown) => int(n, 'Identifiant', 1, 2_000_000_000));
  const result = await prisma.robloxDenylist.deleteMany({ where: { guildId: c.guild.id, id: { in: ids } } });
  await audit(c, 'Liste de refus modifiée (panel)', `${result.count} entrée(s) supprimée(s)`);
  return { deleted: result.count };
});

// ───── Roblox : journal d'audit ─────

route('GET', '/api/guilds/(\\d+)/roblox/audit', true, async c => {
  const limit = Math.min(Math.max(Number(c.url.searchParams.get('limit')) || 100, 1), 200);
  const before = Number(c.url.searchParams.get('before')) || undefined;

  const logs = await prisma.robloxAuditLog.findMany({
    where: { guildId: c.guild.id, ...(before ? { id: { lt: before } } : {}) },
    orderBy: { id: 'desc' },
    take: limit
  });

  return {
    logs: logs.map(l => ({
      id: l.id,
      actorId: l.actorId,
      actorName: l.actorName,
      action: l.action,
      details: l.details,
      createdAt: l.createdAt.toISOString()
    }))
  };
});

// ───── Roblox : embed de vérification ─────

interface EmbedSettings {
  title: string;
  description: string;
  color: string;
  channelId: string | null;
}

route('GET', '/api/guilds/(\\d+)/roblox/embed', true, async c => {
  const config = await prisma.robloxConfig.findUnique({ where: { guildId: c.guild.id }, select: { verifyEmbed: true } });
  let saved: Partial<EmbedSettings> = {};
  try {
    saved = config?.verifyEmbed ? JSON.parse(config.verifyEmbed) : {};
  } catch {
    saved = {};
  }
  return {
    title: saved.title ?? 'Vérification Roblox',
    description: saved.description ?? 'Liez votre compte Roblox pour recevoir automatiquement vos rôles et votre pseudo.',
    color: saved.color ?? '#0099ff',
    channelId: saved.channelId ?? null
  };
});

route('POST', '/api/guilds/(\\d+)/roblox/embed/send', true, async c => {
  const title = text(c.body.title, 'Le titre', 256);
  const description = text(c.body.description, 'La description', 2000);
  if (!title && !description) throw new HttpError(400, 'Renseignez au moins un titre ou une description');

  const color = typeof c.body.color === 'string' && HEX_COLOR.test(c.body.color) ? c.body.color : '#0099ff';
  const channel = textChannel(c.guild, c.body.channelId, 'Le salon');

  const embed = new EmbedBuilder().setColor(color as `#${string}`);
  if (title) embed.setTitle(title);
  if (description) embed.setDescription(description);

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setLabel('Lier mon compte')
      .setStyle(ButtonStyle.Link)
      .setURL(`${c.config.publicUrl}/verify/start?guild=${c.guild.id}`),
    new ButtonBuilder().setCustomId('roblox_update_roles').setLabel('Mettre à jour mes rôles').setStyle(ButtonStyle.Success)
  );

  const message = await channel.send({ embeds: [embed], components: [row] });

  const settings: EmbedSettings = { title, description, color, channelId: channel.id };
  await prisma.robloxConfig.upsert({
    where: { guildId: c.guild.id },
    create: { guildId: c.guild.id, verifyEmbed: JSON.stringify(settings) },
    update: { verifyEmbed: JSON.stringify(settings) }
  });

  await audit(c, 'Embed de vérification envoyé (panel)', `Salon : <#${channel.id}>`);
  return { url: message.url };
});

// ───── Roblox : synchronisation de tous les membres ─────

route('GET', '/api/guilds/(\\d+)/roblox/sync', true, async c => ({ running: isSyncing(c.guild.id) }));

route('POST', '/api/guilds/(\\d+)/roblox/sync', true, async c => {
  if (isSyncing(c.guild.id)) throw new HttpError(409, 'Une synchronisation est déjà en cours');

  const guild = c.guild;
  const actor = { id: c.user.id, name: c.user.username };
  await logRobloxAudit(guild, 'Synchronisation lancée (panel)', 'Mise à jour de tous les membres', actor);

  syncGuild(guild)
    .then(summary =>
      logRobloxAudit(
        guild,
        'Synchronisation terminée',
        `${summary.total} membres traités, ${summary.changed} modifiés, ${summary.failed} erreurs`,
        actor
      )
    )
    .catch(error => console.error('❌ Synchronisation depuis le panel échouée:', error));

  return { started: true };
});

// ───── Roblox : infos sur les groupes (noms, icônes, rangs) ─────

route('GET', '/api/roblox/groups', false, async c => {
  const ids = (c.url.searchParams.get('ids') ?? '').split(',').map(s => s.trim()).filter(Boolean);
  return { groups: await getGroupsInfo(ids) };
});

route('GET', '/api/roblox/groups/(\\d{1,15})/roles', false, async c => {
  try {
    const roles = await getGroupRoles(c.params[0]);
    if (!roles) throw new HttpError(404, 'Groupe introuvable');
    return { roles };
  } catch (error) {
    if (error instanceof RobloxApiError) throw new HttpError(502, error.message);
    throw error;
  }
});

// ───── Giveaways ─────

route('GET', '/api/guilds/(\\d+)/giveaways', true, async c => {
  const giveaways = await prisma.giveaway.findMany({
    where: { guildId: c.guild.id },
    orderBy: { endTime: 'desc' },
    take: 25,
    include: { _count: { select: { participants: true } } }
  });

  return {
    giveaways: giveaways.map(g => ({
      id: g.id,
      title: g.prize,
      description: g.description,
      winners: g.winners,
      channelId: g.channelId,
      endTime: g.endTime.toISOString(),
      ended: g.ended,
      participants: g._count.participants,
      url: `https://discord.com/channels/${g.guildId}/${g.channelId}/${g.messageId}`
    }))
  };
});

route('POST', '/api/guilds/(\\d+)/giveaways', true, async c => {
  const title = text(c.body.title, 'Le titre', 100, true);
  const description = text(c.body.description, 'La description', 1000, true);
  const winners = int(c.body.winners, 'Le nombre de gagnants', 1, 50);
  const minutes = int(c.body.durationMinutes, 'La durée (minutes)', 1, 60 * 24 * 60);
  const channel = textChannel(c.guild, c.body.channelId, 'Le salon');

  const message = await createGiveaway(c.guild, channel, {
    title,
    description,
    winners,
    durationMs: minutes * 60 * 1000,
    hostId: c.user.id
  });

  return { url: message.url };
});

route('POST', '/api/guilds/(\\d+)/giveaways/(\\d+)/end', true, async c => {
  const giveaway = await prisma.giveaway.findFirst({ where: { id: c.params[1], guildId: c.guild.id } });
  if (!giveaway) throw new HttpError(404, 'Giveaway introuvable');
  if (giveaway.ended) throw new HttpError(400, 'Ce giveaway est déjà terminé');

  // La boucle du bot (ready.ts) termine tous les giveaways dont l'heure de fin est passée
  await prisma.giveaway.update({ where: { id: giveaway.id }, data: { endTime: new Date() } });
  return { ok: true };
});

// ───── Invitations ─────

route('GET', '/api/guilds/(\\d+)/invites', true, async c => {
  const [grouped, bonuses] = await Promise.all([
    prisma.invite.groupBy({ by: ['inviterId'], _sum: { uses: true, left: true, fake: true }, where: { guildId: c.guild.id } }),
    prisma.inviteBonus.findMany({ where: { guildId: c.guild.id } })
  ]);

  const rows = new Map<string, { userId: string; uses: number; left: number; fake: number; bonus: number }>();
  const row = (id: string) => {
    let r = rows.get(id);
    if (!r) rows.set(id, (r = { userId: id, uses: 0, left: 0, fake: 0, bonus: 0 }));
    return r;
  };

  for (const g of grouped) {
    const r = row(g.inviterId);
    r.uses = g._sum.uses ?? 0;
    r.left = g._sum.left ?? 0;
    r.fake = g._sum.fake ?? 0;
  }
  for (const b of bonuses) row(b.userId).bonus = b.amount;

  const top = [...rows.values()]
    .filter(r => r.userId !== '0')
    .map(r => ({ ...r, total: r.uses - r.left - r.fake + r.bonus }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 25)
    .map(r => ({ ...r, name: c.guild.members.cache.get(r.userId)?.displayName ?? null }));

  return { leaderboard: top };
});

route('POST', '/api/guilds/(\\d+)/invites/bonus', true, async c => {
  const userId = String(c.body.userId ?? '').trim();
  if (!SNOWFLAKE.test(userId)) throw new HttpError(400, 'Identifiant Discord invalide');
  const amount = int(c.body.amount, 'Le nombre d\'invitations', -10000, 10000);
  if (amount === 0) throw new HttpError(400, 'Le nombre d\'invitations ne peut pas être 0');

  const member = await c.guild.members.fetch(userId).catch(() => null);
  if (!member) throw new HttpError(404, 'Ce membre n\'est pas sur le serveur');

  await ensureGuildRow(c.guild.id);
  const key = { guildId_userId: { guildId: c.guild.id, userId } };
  const current = await prisma.inviteBonus.findUnique({ where: key });
  const next = (current?.amount ?? 0) + amount;
  if (next < 0) throw new HttpError(400, `Ce membre n'a que ${current?.amount ?? 0} invitation(s) bonus`);

  await prisma.inviteBonus.upsert({
    where: key,
    create: { guildId: c.guild.id, userId, amount: next },
    update: { amount: next }
  });

  return { userId, bonus: next };
});

// ───── Dispatcher ─────

export async function routeApi(request: ApiRequest): Promise<unknown> {
  const { url, method } = request;

  for (const r of routes) {
    if (r.method !== method) continue;
    const match = url.pathname.match(r.pattern);
    if (!match) continue;

    const params = match.slice(1);
    if (!r.guildScoped) {
      return r.handler({ ...request, params, guild: null as unknown as Guild, member: null as unknown as GuildMember });
    }

    const { guild, member } = await resolveAccess(request.client, params[0], request.user.id);
    return r.handler({ ...request, params, guild, member });
  }

  throw new HttpError(404, 'Route inconnue');
}
