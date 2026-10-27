import { Events, Invite } from 'discord.js';
import { prisma } from '../utils/prisma';
import { addCachedInvite } from '../utils/inviteCache';

export const name = Events.InviteCreate;

export async function execute(invite: Invite) {
  if (!invite.guild) return;

  try {
    addCachedInvite(
      invite.guild.id,
      invite.code,
      invite.inviter?.id ?? null,
      invite.uses ?? 0,
      invite.maxUses ?? 0
    );

    await prisma.guild.upsert({
      where: { id: invite.guild.id },
      create: { id: invite.guild.id, moderationRoles: '[]' },
      update: {}
    });

    await prisma.invite.upsert({
      where: { id_guildId: { id: invite.code, guildId: invite.guild.id } },
      create: {
        id: invite.code,
        guildId: invite.guild.id,
        inviterId: invite.inviter?.id ?? '0',
        uses: 0
      },
      update: {}
    });
  } catch (error) {
    console.error('❌ Erreur dans inviteCreate:', error);
  }
}
