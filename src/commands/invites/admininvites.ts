import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { prisma } from '../../utils/prisma';

export const data = new SlashCommandBuilder()
  .setName('admininvites')
  .setDescription('Gérer les invitations bonus d\'un utilisateur')
  .addSubcommand(subcommand =>
    subcommand
      .setName('add')
      .setDescription('Ajouter des invitations bonus à un utilisateur')
      .addUserOption(option =>
        option.setName('user').setDescription('L\'utilisateur à qui ajouter les invitations').setRequired(true))
      .addIntegerOption(option =>
        option.setName('amount').setDescription('Le nombre d\'invitations à ajouter').setRequired(true).setMinValue(1)))
  .addSubcommand(subcommand =>
    subcommand
      .setName('remove')
      .setDescription('Retirer des invitations bonus à un utilisateur')
      .addUserOption(option =>
        option.setName('user').setDescription('L\'utilisateur à qui retirer les invitations').setRequired(true))
      .addIntegerOption(option =>
        option.setName('amount').setDescription('Le nombre d\'invitations à retirer').setRequired(true).setMinValue(1)))
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

export async function execute(interaction: ChatInputCommandInteraction) {
  try {
    if (!interaction.guildId) {
      return interaction.reply({ content: 'Cette commande doit être utilisée dans un serveur.', flags: MessageFlags.Ephemeral });
    }

    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({
        content: 'Vous devez être administrateur pour utiliser cette commande.',
        flags: MessageFlags.Ephemeral
      });
    }

    const guildId = interaction.guildId;
    const subcommand = interaction.options.getSubcommand();
    const targetUser = interaction.options.getUser('user', true);
    const amount = interaction.options.getInteger('amount', true);

    await prisma.guild.upsert({
      where: { id: guildId },
      create: { id: guildId, moderationRoles: '[]' },
      update: {}
    });

    const key = { guildId_userId: { guildId, userId: targetUser.id } };
    const current = await prisma.inviteBonus.findUnique({ where: key });
    const currentAmount = current?.amount ?? 0;

    if (subcommand === 'remove' && amount > currentAmount) {
      return interaction.reply({
        content: `❌ ${targetUser.username} n'a que ${currentAmount} invitation${currentAmount > 1 ? 's' : ''} bonus.`,
        flags: MessageFlags.Ephemeral
      });
    }

    const updated = await prisma.inviteBonus.upsert({
      where: key,
      create: { guildId, userId: targetUser.id, amount },
      update: { amount: subcommand === 'add' ? { increment: amount } : { decrement: amount } }
    });

    const added = subcommand === 'add';
    const embed = new EmbedBuilder()
      .setColor(added ? '#00ff00' : '#ff0000')
      .setTitle(`${added ? '➕' : '➖'} Invitations bonus ${added ? 'ajoutées' : 'retirées'}`)
      .setDescription(
        `${amount} invitation${amount > 1 ? 's' : ''} ${added ? 'ajoutée' : 'retirée'}${amount > 1 ? 's' : ''} à ${targetUser}\n` +
        `Nouveau total d'invitations bonus: ${updated.amount}`
      )
      .setTimestamp();

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  } catch (error) {
    console.error('❌ Erreur dans la commande admininvites:', error);
    const payload = { content: '❌ Une erreur est survenue lors de l\'exécution de la commande.', flags: MessageFlags.Ephemeral } as const;
    if (interaction.replied || interaction.deferred) await interaction.followUp(payload).catch(() => {});
    else await interaction.reply(payload).catch(() => {});
  }
}
