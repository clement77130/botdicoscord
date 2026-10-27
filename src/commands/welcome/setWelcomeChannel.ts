import { SlashCommandBuilder, ChannelType, TextChannel, PermissionFlagsBits, ChatInputCommandInteraction } from 'discord.js';
import { prisma } from '../../utils/prisma';


export const data = new SlashCommandBuilder()
  .setName('setwelcome')
  .setDescription('Définir le salon de bienvenue')
  .addChannelOption(option =>
    option.setName('channel')
      .setDescription('Le salon où seront envoyés les messages de bienvenue')
      .setRequired(true)
      .addChannelTypes(ChannelType.GuildText))
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

export async function execute(interaction: ChatInputCommandInteraction) {
  if (!interaction.inCachedGuild()) {
    return interaction.reply({
      content: 'Cette commande doit être utilisée dans un serveur.',
      ephemeral: true
    });
  }

  if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({
      content: 'Vous devez être administrateur pour utiliser cette commande.',
      ephemeral: true
    });
  }

  const channel = interaction.options.getChannel('channel') as TextChannel;
  
  await prisma.guild.upsert({
    where: {
      id: interaction.guildId
    },
    update: {
      welcomeChannelId: channel.id
    },
    create: {
      id: interaction.guildId,
      welcomeChannelId: channel.id
    }
  });

  await interaction.reply({
    content: `Le salon de bienvenue a été défini sur ${channel}`,
    ephemeral: true
  });
} 