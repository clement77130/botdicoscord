import { 
  ButtonInteraction,
  EmbedBuilder,
  TextChannel,
  ChannelType
} from 'discord.js';
import { prisma } from '../../../utils/prisma';
import { isStaff } from '../../../utils/ticketUtils';
import discordTranscripts from 'discord-html-transcripts';


export async function handleDelete(interaction: ButtonInteraction<'cached'>) {
  await interaction.deferReply({ ephemeral: true });

  if (!(await isStaff(interaction.member))) {
    return interaction.editReply({ content: 'Seul le staff peut supprimer un ticket.' });
  }

  const ticket = await prisma.ticket.findFirst({
    where: { 
      OR: [
        { id: interaction.channelId },
        { channelId: interaction.channelId }
      ]
    }
  });

  if (!ticket) {
    return interaction.editReply({
      content: 'Ce ticket n\'existe pas dans la base de données.'
    });
  }

  try {
    const channel = interaction.channel as TextChannel;
    const transcript = await discordTranscripts.createTranscript(channel, {
      limit: -1,
      filename: `ticket-${channel.name}.html`,
      saveImages: true
    });

    const guildData = await prisma.guild.findUnique({
      where: { id: ticket.guildId }
    });

    if (guildData?.logChannelId) {
      const logChannel = await interaction.guild?.channels.fetch(guildData.logChannelId) as TextChannel;
      if (logChannel?.type === ChannelType.GuildText) {
        const archiveEmbed = new EmbedBuilder()
          .setColor('#808080')
          .setTitle('Ticket Archivé')
          .setDescription(
            `**Ticket:** ${channel.name}\n` +
            `**Créé par:** <@${ticket.userId}>\n` +
            `**Catégorie:** ${ticket.category}\n` +
            `**Archivé par:** ${interaction.user.tag}`
          )
          .setTimestamp();

        await logChannel.send({ 
          embeds: [archiveEmbed],
          files: [transcript]
        });
      }
    }

    await interaction.editReply({
      content: 'Le ticket va être supprimé...'
    });

    setTimeout(async () => {
      try {
        await interaction.channel?.delete();
      } catch (error) {
        console.error('Erreur lors de la suppression du ticket:', error);
      }
    }, 5000);
  } catch (error) {
    console.error('Erreur lors de la suppression du ticket:', error);
    await interaction.editReply({
      content: 'Une erreur est survenue lors de la suppression du ticket.'
    });
  }
} 