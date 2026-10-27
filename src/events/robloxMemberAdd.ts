import { Events, GuildMember } from 'discord.js';
import { prisma } from '../utils/prisma';
import { loadGuildSettings, updateMember } from '../utils/robloxSync';

export const name = Events.GuildMemberAdd;

// Un membre déjà lié (sur n'importe quel serveur) récupère ses rôles dès son arrivée
export async function execute(member: GuildMember) {
  try {
    if (member.user.bot) return;

    const settings = await loadGuildSettings(member.guild.id);
    if (!settings.config && settings.binds.length === 0) return;
    if (settings.config && !settings.config.autoUpdateOnJoin) return;

    const link = await prisma.robloxLink.findUnique({ where: { discordId: member.id } });
    // Non lié : seul le rôle « non vérifié » éventuel est attribué
    if (!link && !settings.config?.unverifiedRoleId) return;

    await updateMember(member, settings);
  } catch (error) {
    console.error('❌ Erreur dans robloxMemberAdd:', error);
  }
}
