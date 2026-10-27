import { 
  ButtonInteraction,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  GuildMember,
  Message
} from 'discord.js';
import { prisma } from '../../../utils/prisma';


export async function handleEnter(interaction: ButtonInteraction<'cached'>) {
  const member = interaction.member as GuildMember;
  const message = interaction.message as Message;

  const giveaway = await prisma.giveaway.findUnique({
    where: { id: message.id },
    include: { participants: true }
  });

  if (!giveaway) {
    await interaction.reply({
      content: 'Ce giveaway n\'existe plus.',
      ephemeral: true
    });
    return;
  }

  if (giveaway.ended) {
    await interaction.reply({
      content: 'Ce giveaway est terminé.',
      ephemeral: true
    });
    return;
  }

  const existingParticipant = giveaway.participants.find(
    (p: { userId: string }) => p.userId === interaction.user.id
  );

  try {
    if (existingParticipant) {
      await prisma.giveawayParticipant.delete({
        where: { id: existingParticipant.id }
      });

      await interaction.reply({
        content: 'Vous ne participez plus à ce giveaway.',
        ephemeral: true
      });
    } else {
      await prisma.giveawayParticipant.create({
        data: {
          giveawayId: giveaway.id,
          userId: interaction.user.id
        }
      });

      await interaction.reply({
        content: 'Vous participez maintenant à ce giveaway!',
        ephemeral: true
      });
    }

    const participantCount = await prisma.giveawayParticipant.count({
      where: { giveawayId: giveaway.id }
    });

    const embed = EmbedBuilder.from(message.embeds[0]);
    embed.setFields([
      { name: '🏆 Gagnants', value: giveaway.winners.toString(), inline: true },
      { name: '⌛ Fin', value: `<t:${Math.floor(giveaway.endTime.getTime() / 1000)}:R>`, inline: true },
      { name: '👥 Participants', value: participantCount.toString(), inline: true },
      { name: '🎮 Host', value: `<@${giveaway.hostId}>`, inline: false }
    ]);

    await message.edit({
      embeds: [embed],
      components: [new ActionRowBuilder<ButtonBuilder>()
        .addComponents(
          new ButtonBuilder()
            .setCustomId('giveaway_enter')
            .setLabel('Participer 🎉')
            .setStyle(ButtonStyle.Success)
        )]
    });
  } catch (error) {
    console.error('Erreur lors de la participation au giveaway:', error);
    throw error;
  }
} 