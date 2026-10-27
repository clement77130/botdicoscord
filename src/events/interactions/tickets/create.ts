import {
  ModalSubmitInteraction,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  PermissionsBitField,
  OverwriteResolvable
} from 'discord.js';
import { prisma } from '../../../utils/prisma';
import { MAX_OPEN_TICKETS_PER_USER, parseModerationRoles, slugify } from '../../../utils/ticketUtils';

export async function handleCreate(interaction: ModalSubmitInteraction<'cached'>) {
  await interaction.deferReply({ ephemeral: true });

  const ticketType = slugify(interaction.customId.replace('ticket_modal_', ''), 20) || 'ticket';
  const rawPseudo = interaction.fields.getTextInputValue('pseudo').trim();
  const pseudoSlug = slugify(rawPseudo, 20) || 'membre';
  const explanation = interaction.fields.getTextInputValue('explanation').trim().slice(0, 3000);

  const guildData = await prisma.guild.findUnique({ where: { id: interaction.guildId } });

  if (!guildData?.ticketCategoryId) {
    return interaction.editReply({ content: 'La catégorie des tickets n\'a pas été configurée.' });
  }

  const category = interaction.guild.channels.cache.get(guildData.ticketCategoryId);
  if (!category) {
    return interaction.editReply({ content: 'La catégorie des tickets est introuvable.' });
  }

  // Limite de tickets ouverts : on ignore (et on ferme en base) ceux dont le salon a été supprimé à la main
  const openTickets = await prisma.ticket.findMany({
    where: { guildId: interaction.guildId, userId: interaction.user.id, status: 'open' }
  });
  const stillOpen = [];
  for (const t of openTickets) {
    if (interaction.guild.channels.cache.has(t.channelId)) stillOpen.push(t);
    else await prisma.ticket.update({ where: { id: t.id }, data: { status: 'closed' } });
  }
  if (stillOpen.length >= MAX_OPEN_TICKETS_PER_USER) {
    return interaction.editReply({
      content: `Vous avez déjà un ticket ouvert : <#${stillOpen[0].channelId}>`
    });
  }

  const Flags = PermissionsBitField.Flags;
  const staffRoleIds = parseModerationRoles(guildData.moderationRoles).filter(id =>
    interaction.guild.roles.cache.has(id)
  );

  const permissionOverwrites: OverwriteResolvable[] = [
    { id: interaction.guild.id, deny: [Flags.ViewChannel] },
    {
      id: interaction.user.id,
      allow: [Flags.ViewChannel, Flags.SendMessages, Flags.ReadMessageHistory]
    },
    // Le bot doit toujours voir et gérer le salon
    {
      id: interaction.client.user.id,
      allow: [Flags.ViewChannel, Flags.SendMessages, Flags.ReadMessageHistory, Flags.ManageChannels, Flags.EmbedLinks, Flags.AttachFiles]
    },
    // Le staff (rôles de modération) voit et répond aux tickets
    ...staffRoleIds.map(id => ({
      id,
      allow: [Flags.ViewChannel, Flags.SendMessages, Flags.ReadMessageHistory, Flags.AttachFiles]
    }))
  ];

  const ticketChannel = await interaction.guild.channels.create({
    name: `${pseudoSlug}-${ticketType}-ouvert`,
    type: ChannelType.GuildText,
    parent: category.id,
    permissionOverwrites
  });

  await prisma.ticket.create({
    data: {
      id: ticketChannel.id,
      guildId: interaction.guildId,
      userId: interaction.user.id,
      channelId: ticketChannel.id,
      category: ticketType,
      status: 'open'
    }
  });

  const ticketEmbed = new EmbedBuilder()
    .setColor('#0099ff')
    .setTitle(`Ticket - ${interaction.user.tag}`)
    .setDescription(
      `**Type:** ${ticketType}\n` +
      `**Créé par:** ${interaction.user}\n` +
      `**Pseudo:** ${rawPseudo.slice(0, 100)}\n` +
      `**Explication:** ${explanation}\n\n` +
      'Un membre du staff vous répondra dès que possible.\n' +
      'Pour fermer le ticket, utilisez la commande `/ticket close` ou le bouton ci-dessous.'
    )
    .setTimestamp();

  const closeButton = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('ticket_close').setLabel('Fermer le ticket').setStyle(ButtonStyle.Danger)
  );

  await ticketChannel.send(`${interaction.user}`);
  await ticketChannel.send({ embeds: [ticketEmbed], components: [closeButton] });

  await interaction.editReply({ content: `Votre ticket a été créé: ${ticketChannel}` });
}
