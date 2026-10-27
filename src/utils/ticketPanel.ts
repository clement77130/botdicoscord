import { ActionRowBuilder, EmbedBuilder, StringSelectMenuBuilder, TextChannel } from 'discord.js';

// Message avec le menu de création de ticket (utilisé par /ticket message et par le panel)
export async function sendTicketPanel(channel: TextChannel) {
  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('ticket_create')
      .setPlaceholder('Sélectionnez une catégorie')
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions([
        { label: 'Bug', description: 'Signaler un bug', value: 'bug', emoji: '🐛' },
        { label: 'Réclamation de récompense', description: 'Réclamer une récompense', value: 'reward', emoji: '🎁' },
        { label: 'Signalement', description: 'Signaler un utilisateur', value: 'report', emoji: '🚨' }
      ])
  );

  const embed = new EmbedBuilder()
    .setColor('#0099ff')
    .setTitle('🎫 Création de ticket')
    .setDescription('Sélectionnez une catégorie pour créer un ticket')
    .setTimestamp();

  return channel.send({ embeds: [embed], components: [row] });
}
