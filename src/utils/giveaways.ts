import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, Guild, TextChannel } from 'discord.js';
import { prisma } from './prisma';

export interface GiveawayOptions {
  title: string;
  description: string;
  winners: number;
  durationMs: number;
  hostId: string;
}

// Crée un giveaway (message + enregistrement). Utilisé par /gstart et par le panel.
export async function createGiveaway(guild: Guild, channel: TextChannel, options: GiveawayOptions) {
  const endTime = new Date(Date.now() + options.durationMs);

  const embed = new EmbedBuilder()
    .setColor('#FF69B4')
    .setTitle('🎉 ' + options.title)
    .setDescription(options.description)
    .addFields([
      { name: '🏆 Gagnants', value: options.winners.toString(), inline: true },
      { name: '⌛ Fin', value: `<t:${Math.floor(endTime.getTime() / 1000)}:R>`, inline: true },
      { name: '👥 Participants', value: '0', inline: true },
      { name: '🎮 Host', value: `<@${options.hostId}>`, inline: false }
    ])
    .setFooter({ text: 'Cliquez sur le bouton ci-dessous pour participer!' })
    .setTimestamp(endTime);

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('giveaway_enter').setLabel('Participer 🎉').setStyle(ButtonStyle.Success)
  );

  const message = await channel.send({ embeds: [embed], components: [row] });

  await prisma.guild.upsert({
    where: { id: guild.id },
    create: { id: guild.id, moderationRoles: '[]' },
    update: {}
  });

  await prisma.giveaway.create({
    data: {
      id: message.id,
      guildId: guild.id,
      channelId: channel.id,
      messageId: message.id,
      prize: options.title,
      description: options.description,
      winners: options.winners,
      endTime,
      hostId: options.hostId
    }
  });

  return message;
}
