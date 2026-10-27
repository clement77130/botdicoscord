import { SlashCommandBuilder, ChannelType, PermissionFlagsBits, GuildMember } from 'discord.js';
import { prisma } from '../../utils/prisma';

export { prisma };

export function formatDuration(duration: string): string {
  const units: { [key: string]: string } = {
    'h': 'heure(s)',
    'd': 'jour(s)',
    'w': 'semaine(s)',
    'm': 'minute(s)',
    's': 'seconde(s)'
  };

  const match = duration.match(/(\d+)([hdwms])/);
  if (!match) return duration;

  const [, value, unit] = match;
  return `${value} ${units[unit]}`;
}

export const data = new SlashCommandBuilder()
  .setName('logs')
  .setDescription('Configurer le salon des logs')
  .addSubcommand(subcommand =>
    subcommand
      .setName('output')
      .setDescription('Définir le salon des logs')
      .addChannelOption(option =>
        option.setName('channel')
          .setDescription('Le salon où seront envoyés les logs')
          .setRequired(true)
          .addChannelTypes(ChannelType.GuildText)))
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

export async function execute(interaction: any) {
  const guildData = await prisma.guild.findUnique({
    where: { id: interaction.guildId }
  });

  const moderationRoles = guildData?.moderationRoles ? JSON.parse(guildData.moderationRoles) as string[] : [];
  const member = interaction.member as GuildMember;
  
  const hasPermission = member.roles.cache.some((role) => 
    moderationRoles.includes(role.id)
  );

  if (!hasPermission) {
    return interaction.reply({
      content: "Vous n'avez pas la permission d'utiliser cette commande.",
      ephemeral: true
    });
  }

  const channel = interaction.options.getChannel('channel');

  await prisma.guild.upsert({
    where: { id: interaction.guildId },
    update: {
      logChannelId: channel.id
    },
    create: {
      id: interaction.guildId,
      logChannelId: channel.id
    }
  });

  await interaction.reply({
    content: `Le salon des logs a été défini sur ${channel}`,
    ephemeral: true
  });
} 