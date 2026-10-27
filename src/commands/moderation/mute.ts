import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ChatInputCommandInteraction, GuildMember } from 'discord.js';
import { prisma } from '../../utils/prisma';
import ms from 'ms';


export const data = new SlashCommandBuilder()
  .setName('mute')
  .setDescription('Exclure temporairement un membre')
  .addUserOption(option =>
    option.setName('user')
      .setDescription('Le membre à exclure temporairement')
      .setRequired(true))
  .addStringOption(option =>
    option.setName('duration')
      .setDescription('Durée de l\'exclusion (ex: 60s, 5m, 1h, 1d, 1w)')
      .setRequired(true)
      .addChoices(
        { name: '60 secondes', value: '60s' },
        { name: '5 minutes', value: '5m' },
        { name: '10 minutes', value: '10m' },
        { name: '1 heure', value: '1h' },
        { name: '1 jour', value: '1d' },
        { name: '1 semaine', value: '1w' }
      ))
  .addStringOption(option =>
    option.setName('reason')
      .setDescription('La raison de l\'exclusion')
      .setRequired(true))
  .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers);

export async function execute(interaction: ChatInputCommandInteraction) {
  if (!interaction.guildId) {
    return interaction.reply({ content: 'Cette commande doit être utilisée dans un serveur.', ephemeral: true });
  }

  const guildData = await prisma.guild.findUnique({
    where: { id: interaction.guildId }
  });

  const moderationRoles = guildData?.moderationRoles ? JSON.parse(guildData.moderationRoles) : [];
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

  const user = interaction.options.getUser('user', true);
  const duration = interaction.options.getString('duration', true);
  const reason = interaction.options.getString('reason', true);
  const targetMember = await interaction.guild?.members.fetch(user.id);

  if (!targetMember) {
    return interaction.reply({
      content: "Membre introuvable.",
      ephemeral: true
    });
  }

  const durationMs = ms(duration);
  if (!durationMs) {
    return interaction.reply({
      content: "Format de durée invalide. Utilisez par exemple: 60s, 5m, 1h, 1d, 1w",
      ephemeral: true
    });
  }

  if (!targetMember.moderatable) {
    return interaction.reply({
      content: "Je ne peux pas exclure temporairement ce membre.",
      ephemeral: true
    });
  }

  const muteEmbed = new EmbedBuilder()
    .setColor('#ffd700')
    .setTitle('⏰ Exclusion temporaire')
    .setDescription(`**Membre:** ${user.tag}\n**Durée:** ${duration}\n**Raison:** ${reason}\n**Modérateur:** ${interaction.user.tag}`)
    .setTimestamp();

  await targetMember.timeout(durationMs, reason);

  if (guildData?.logChannelId) {
    if (!interaction.guild) return;
    const logChannel = interaction.guild.channels.cache.get(guildData.logChannelId);
    if (logChannel?.isTextBased()) {
      await logChannel.send({ embeds: [muteEmbed] });
    }
  }

  await interaction.reply({
    content: `${user.tag} a été exclu temporairement pour ${duration}.`,
    ephemeral: true
  });
} 