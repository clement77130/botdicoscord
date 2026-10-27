import { ButtonInteraction, TextChannel, ChannelType } from 'discord.js';
import { prisma } from '../../../utils/prisma';
import { isStaff } from '../../../utils/ticketUtils';
import { reopenTicket } from '../../../utils/ticketActions';

export async function handleReopen(interaction: ButtonInteraction<'cached'>) {
  await interaction.deferReply({ ephemeral: true });

  // Seul le staff peut réouvrir ou supprimer un ticket fermé
  if (!(await isStaff(interaction.member))) {
    return interaction.editReply({ content: 'Seul le staff peut réouvrir un ticket.' });
  }

  const ticket = await prisma.ticket.findFirst({
    where: { OR: [{ id: interaction.channelId }, { channelId: interaction.channelId }] }
  });

  if (!ticket) {
    return interaction.editReply({ content: 'Ce ticket n\'existe pas dans la base de données.' });
  }

  if (ticket.status === 'open') {
    return interaction.editReply({ content: 'Ce ticket est déjà ouvert.' });
  }

  const channel = interaction.channel as TextChannel;
  if (!channel || channel.type !== ChannelType.GuildText) {
    return interaction.editReply({ content: 'Ce salon n\'est pas un salon de ticket valide.' });
  }

  try {
    await reopenTicket(channel, ticket, interaction.user.tag);
    await interaction.editReply({ content: 'Le ticket a été réouvert.' });
  } catch (error) {
    console.error('[ERROR] Error during ticket reopen:', error);
    await interaction.editReply({ content: 'Une erreur est survenue lors de la réouverture du ticket.' });
  }
}
