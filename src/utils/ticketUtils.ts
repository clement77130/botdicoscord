import { GuildMember, PermissionFlagsBits } from 'discord.js';
import { prisma } from './prisma';

// Nombre maximum de tickets ouverts en même temps par membre
export const MAX_OPEN_TICKETS_PER_USER = 1;

export function slugify(input: string, max = 20): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, max);
}

// "pseudo-bug-ouvert" -> "pseudo-bug" (fonctionne même si le nom contient d'autres tirets)
export function baseTicketName(channelName: string): string {
  return channelName.replace(/-(ouvert|fermé|ferme)$/, '');
}

export function parseModerationRoles(raw: string | null | undefined): string[] {
  try {
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

// Staff = administrateur du serveur ou possesseur d'un rôle de modération configuré via /mod
export async function isStaff(member: GuildMember): Promise<boolean> {
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;

  const guildData = await prisma.guild.findUnique({
    where: { id: member.guild.id },
    select: { moderationRoles: true }
  });
  const staffRoles = parseModerationRoles(guildData?.moderationRoles);
  return member.roles.cache.some(role => staffRoles.includes(role.id));
}
