import { AuditLogEvent, EmbedBuilder, Events, GuildMember, PartialGuildMember } from 'discord.js';
import { prisma } from '../utils/prisma';

export const name = Events.GuildMemberRemove;
export const once = false;

const AUDIT_WINDOW_MS = 10_000;

// Reçoit un PartialGuildMember quand le membre n'était pas en cache (ex: après un redémarrage)
export async function execute(member: GuildMember | PartialGuildMember) {
  try {
    if (member.user?.bot) return;

    const guildId = member.guild.id;
    const tag = member.user?.tag ?? member.id;

    const memberJoin = await prisma.memberJoin.findUnique({
      where: { memberId_guildId: { memberId: member.id, guildId } },
      include: { invite: true }
    });

    if (memberJoin) {
      await prisma.invite.update({
        where: { id_guildId: { id: memberJoin.inviteId, guildId } },
        data: { left: { increment: 1 } }
      });
    }

    // Discord écrit l'entrée d'audit log avec un léger retard
    await new Promise(resolve => setTimeout(resolve, 1500));

    let kickLog: any = null;
    let banLog: any = null;
    try {
      const [kicks, bans] = await Promise.all([
        member.guild.fetchAuditLogs({ limit: 5, type: AuditLogEvent.MemberKick }),
        member.guild.fetchAuditLogs({ limit: 5, type: AuditLogEvent.MemberBanAdd })
      ]);
      const recent = (e: any) => e.target?.id === member.id && e.createdTimestamp > Date.now() - AUDIT_WINDOW_MS;
      kickLog = kicks.entries.find(recent) ?? null;
      banLog = bans.entries.find(recent) ?? null;
    } catch {
      // Permission "Voir les logs du serveur" manquante : on log juste un départ
    }

    const wasBanned = !!banLog;
    const wasKicked = !wasBanned && !!kickLog;
    const leaveReason = wasBanned ? 'a été banni' : wasKicked ? 'a été expulsé' : 'a quitté';

    const guildData = await prisma.guild.findUnique({ where: { id: guildId } });
    if (!guildData?.logChannelId) return;

    const logChannel = member.guild.channels.cache.get(guildData.logChannelId);
    if (!logChannel?.isTextBased()) return;

    const entry = wasBanned ? banLog : kickLog;
    const leaveEmbed = new EmbedBuilder()
      .setColor(wasBanned ? '#ff0000' : wasKicked ? '#ffa500' : '#808080')
      .setTitle('👋 Membre parti')
      .setThumbnail(member.user?.displayAvatarURL() ?? null)
      .setDescription(
        `**${tag}** ${leaveReason} le serveur.\n` +
        (memberJoin ? `**Invité par:** <@${memberJoin.invite.inviterId}>\n` : '**Inviteur:** Inconnu\n') +
        (entry
          ? `**${wasBanned ? 'Banni' : 'Expulsé'} par:** ${entry.executor}\n**Raison:** ${entry.reason || 'Aucune raison spécifiée'}`
          : '')
      )
      .setTimestamp();

    await logChannel.send({ embeds: [leaveEmbed] });
  } catch (error) {
    console.error('❌ Erreur dans guildMemberRemove:', error);
  }
}
