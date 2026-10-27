import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ChatInputCommandInteraction, GuildMember } from 'discord.js';
import { prisma } from '../../utils/prisma';


export const data = new SlashCommandBuilder()
  .setName('mod')
  .setDescription('Gérer les rôles de modération')
  .addSubcommand(subcommand =>
    subcommand
      .setName('add')
      .setDescription('Ajouter un rôle de modération')
      .addRoleOption(option =>
        option.setName('role')
          .setDescription('Le rôle à ajouter')
          .setRequired(true)))
  .addSubcommand(subcommand =>
    subcommand
      .setName('remove')
      .setDescription('Retirer un rôle de modération')
      .addRoleOption(option =>
        option.setName('role')
          .setDescription('Le rôle à retirer')
          .setRequired(true)))
  .addSubcommand(subcommand =>
    subcommand
      .setName('list')
      .setDescription('Lister les rôles de modération'))
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

export async function execute(interaction: ChatInputCommandInteraction) {
  if (!interaction.guildId) {
    return interaction.reply({ content: 'Cette commande doit être utilisée dans un serveur.', ephemeral: true });
  }
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({
      content: 'Vous devez être administrateur pour utiliser cette commande.',
      ephemeral: true
    });
  }

  const subcommand = interaction.options.getSubcommand();

  switch (subcommand) {
    case 'add': {
      const role = interaction.options.getRole('role', true);
      const guildData = await prisma.guild.findUnique({
        where: { id: interaction.guildId }
      });

      if (guildData) {
        const currentRoles = JSON.parse(guildData.moderationRoles) as string[];
        if (currentRoles.includes(role.id)) {
          return interaction.reply({
            content: 'Ce rôle est déjà un rôle de modération.',
            ephemeral: true
          });
        }

        await prisma.guild.update({
          where: { id: interaction.guildId },
          data: {
            moderationRoles: JSON.stringify([...currentRoles, role.id])
          }
        });
      } else {
        await prisma.guild.create({
          data: {
            id: interaction.guildId,
            moderationRoles: JSON.stringify([role.id])
          }
        });
      }

      await interaction.reply({
        content: `${role.name} a été ajouté aux rôles de modération.`,
        ephemeral: true
      });
      break;
    }

    case 'remove': {
      const role = interaction.options.getRole('role', true);
      const guildData = await prisma.guild.findUnique({
        where: { id: interaction.guildId }
      });

      if (!guildData) {
        return interaction.reply({
          content: 'Aucun rôle de modération n\'est configuré.',
          ephemeral: true
        });
      }

      const currentRoles = JSON.parse(guildData.moderationRoles) as string[];
      if (!currentRoles.includes(role.id)) {
        return interaction.reply({
          content: 'Ce rôle n\'est pas un rôle de modération.',
          ephemeral: true
        });
      }

      await prisma.guild.update({
        where: { id: interaction.guildId },
        data: {
          moderationRoles: JSON.stringify(currentRoles.filter(id => id !== role.id))
        }
      });

      await interaction.reply({
        content: `${role.name} a été retiré des rôles de modération.`,
        ephemeral: true
      });
      break;
    }

    case 'list': {
      const guildData = await prisma.guild.findUnique({
        where: { id: interaction.guildId }
      });

      if (!guildData || !interaction.guild) {
        return interaction.reply({
          content: 'Aucun rôle de modération n\'est configuré.',
          ephemeral: true
        });
      }

      const currentRoles = JSON.parse(guildData.moderationRoles) as string[];
      const roles = currentRoles.map(roleId => {
        const role = interaction.guild?.roles.cache.get(roleId);
        return role ? `- ${role.name}` : `- Rôle inconnu (${roleId})`;
      });

      const embed = new EmbedBuilder()
        .setColor('#0099ff')
        .setTitle('🛡️ Rôles de modération')
        .setDescription(roles.length > 0 ? roles.join('\n') : 'Aucun rôle configuré')
        .setTimestamp();

      await interaction.reply({
        embeds: [embed],
        ephemeral: true
      });
      break;
    }
  }
} 