import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ChatInputCommandInteraction, GuildMember } from 'discord.js';
import { prisma } from '../../utils/prisma';


export const data = new SlashCommandBuilder()
  .setName('unban')
  .setDescription('Débannir un membre')
  .addStringOption(option =>
    option.setName('userid')
      .setDescription('L\'ID du membre à débannir')
      .setRequired(true))
  .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers);

export async function execute(interaction: ChatInputCommandInteraction) {
  if (!interaction.guildId) {
    return interaction.reply({ content: 'Cette commande doit être utilisée dans un serveur.', ephemeral: true });
  }

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

  const userId = interaction.options.getString('userid', true);
  if (!interaction.guild) {
    return interaction.reply({ content: 'Cette commande doit être utilisée dans un serveur.', ephemeral: true });
  }

  try {
    const banList = await interaction.guild.bans.fetch();
    const bannedUser = banList.find((ban: { user: { id: string } }) => ban.user.id === userId);

    if (!bannedUser) {
      return interaction.reply({
        content: "Cet utilisateur n'est pas banni.",
        ephemeral: true
      });
    }

    const unbanEmbed = new EmbedBuilder()
      .setColor('#00ff00')
      .setTitle('🔓 Débannissement')
      .setDescription(`**Membre débanni:** ${bannedUser.user.tag}\n**Modérateur:** ${interaction.user.tag}`)
      .setTimestamp();

    await interaction.guild.members.unban(userId);

    if (guildData?.logChannelId) {
      const logChannel = interaction.guild.channels.cache.get(guildData.logChannelId);
      if (logChannel?.isTextBased()) {
        await logChannel.send({ embeds: [unbanEmbed] });
      }
    }

    await interaction.reply({
      content: `${bannedUser.user.tag} a été débanni avec succès.`,
      ephemeral: true
    });
  } catch (error) {
    await interaction.reply({
      content: "Une erreur est survenue lors du débannissement.",
      ephemeral: true
    });
  }
} 