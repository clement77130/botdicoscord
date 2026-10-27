import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, TextChannel } from 'discord.js';
import type { Ticket } from '@prisma/client';
import { prisma } from './prisma';
import { baseTicketName } from './ticketUtils';

async function renameChannel(channel: TextChannel, name: string) {
  try {
    await Promise.race([
      channel.setName(name),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 5000))
    ]);
  } catch (error) {
    // Discord limite fortement les renommages de salons (2 par 10 minutes) : on continue quand même
    console.error('[ERROR] Failed to rename channel (continuing anyway):', error);
  }
}

export async function closeTicket(channel: TextChannel, ticket: Ticket, closedByTag: string) {
  await prisma.ticket.update({
    where: { id: ticket.id },
    data: { status: 'closed', channelId: channel.id }
  });

  const closeEmbed = new EmbedBuilder()
    .setColor('#ff0000')
    .setTitle('Ticket Fermé')
    .setDescription(`Ticket fermé par ${closedByTag}`)
    .setTimestamp();

  const archiveRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('ticket_delete').setLabel('Supprimer le ticket').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('ticket_reopen').setLabel('Réouvrir le ticket').setStyle(ButtonStyle.Success)
  );

  await channel.send({ embeds: [closeEmbed], components: [archiveRow] });
  await channel.permissionOverwrites.edit(ticket.userId, { SendMessages: false });
  await renameChannel(channel, `${baseTicketName(channel.name)}-fermé`);
}

export async function reopenTicket(channel: TextChannel, ticket: Ticket, reopenedByTag: string) {
  await channel.permissionOverwrites.edit(ticket.userId, {
    ViewChannel: true,
    SendMessages: true,
    ReadMessageHistory: true
  });

  await prisma.ticket.update({
    where: { id: ticket.id },
    data: { status: 'open', channelId: channel.id }
  });

  const reopenEmbed = new EmbedBuilder()
    .setColor('#00ff00')
    .setTitle('Ticket Réouvert')
    .setDescription(`Ticket réouvert par ${reopenedByTag}`)
    .setTimestamp();

  await channel.send({ content: `<@${ticket.userId}>`, embeds: [reopenEmbed] });

  const ticketEmbed = new EmbedBuilder()
    .setColor('#0099ff')
    .setTitle('Ticket')
    .setDescription(
      'Un membre du staff vous répondra dès que possible.\n' +
      'Pour fermer le ticket, utilisez la commande `/ticket close` ou le bouton ci-dessous.'
    )
    .setTimestamp();

  const closeButton = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('ticket_close').setLabel('Fermer le ticket').setStyle(ButtonStyle.Danger)
  );

  await channel.send({ embeds: [ticketEmbed], components: [closeButton] });
  await renameChannel(channel, `${baseTicketName(channel.name)}-ouvert`);
}
