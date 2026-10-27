import { EmbedBuilder, Events, GuildMember } from 'discord.js';
import { prisma } from '../utils/prisma';
import { findUsedInvite } from '../utils/inviteCache';

export const name = Events.GuildMemberAdd;

const FAKE_ACCOUNT_AGE_MS = 7 * 24 * 60 * 60 * 1000; // compte de moins de 7 jours = suspect

export async function execute(member: GuildMember) {
  try {
    if (member.user.bot) return;

    await prisma.guild.upsert({
      where: { id: member.guild.id },
      create: { id: member.guild.id, moderationRoles: '[]' },
      update: {}
    });

    // Invitation réellement utilisée (comparaison avec le snapshot des utilisations)
    const usedInvite = await findUsedInvite(member.guild);
    let inviterId: string | null = null;
    let hasReturned = false;

    if (usedInvite && usedInvite.inviterId) {
      inviterId = usedInvite.inviterId;
      const guildId = member.guild.id;
      const isFake = Date.now() - member.user.createdTimestamp < FAKE_ACCOUNT_AGE_MS;

      const existing = await prisma.memberJoin.findUnique({
        where: { memberId_guildId: { memberId: member.id, guildId } },
        include: { invite: true }
      });

      hasReturned = !!existing;
      const sameInviter = existing?.invite.inviterId === inviterId;

      if (existing && sameInviter) {
        // Il revient via le même inviteur : on annule son départ, sans recompter l'invitation
        await prisma.invite.updateMany({
          where: { id: existing.inviteId, guildId, left: { gt: 0 } },
          data: { left: { decrement: 1 } }
        });
      }

      const countAsNew = !existing || !sameInviter;

      await prisma.invite.upsert({
        where: { id_guildId: { id: usedInvite.code, guildId } },
        create: {
          id: usedInvite.code,
          guildId,
          inviterId,
          uses: 1,
          left: 0,
          fake: isFake ? 1 : 0
        },
        update: countAsNew
          ? {
              uses: { increment: 1 },
              ...(isFake ? { fake: { increment: 1 } } : {})
            }
          : {}
      });

      await prisma.memberJoin.upsert({
        where: { memberId_guildId: { memberId: member.id, guildId } },
        create: { memberId: member.id, guildId, inviteId: usedInvite.code, joinedAt: new Date() },
        update: { inviteId: usedInvite.code, joinedAt: new Date() }
      });
    } else {
      console.log(`❓ Invitation inconnue pour ${member.user.tag} (lien personnalisé, invitation expirée ou permission manquante)`);
    }

    const guildData = await prisma.guild.findUnique({ where: { id: member.guild.id } });
    if (!guildData?.welcomeChannelId) return;

    const welcomeChannel = member.guild.channels.cache.get(guildData.welcomeChannelId);
    if (!welcomeChannel?.isTextBased()) return;

    const welcomeEmbed = new EmbedBuilder()
      .setColor('#0099ff')
      .setTitle(`Bienvenue sur ${member.guild.name}`)
      .setThumbnail(member.user.displayAvatarURL())
      .setDescription(
        `${member.user} vient de nous rejoindre.\n` +
        `Invité par ${inviterId ? `<@${inviterId}>` : 'un lien inconnu'}.\n` +
        `${hasReturned ? '(Ce membre était déjà venu auparavant)\n' : ''}` +
        `Le serveur compte désormais ${member.guild.memberCount} membres.`
      )
      .setTimestamp();

    await welcomeChannel.send({ embeds: [welcomeEmbed] });
  } catch (error) {
    console.error('❌ Erreur dans guildMemberAdd:', error);
  }
}
