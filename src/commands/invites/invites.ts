import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder, MessageFlags } from 'discord.js';
import { prisma } from '../../utils/prisma';

export const data = new SlashCommandBuilder()
  .setName('invites')
  .setDescription('Voir vos statistiques d\'invitations')
  .addUserOption(option =>
    option
      .setName('user')
      .setDescription('L\'utilisateur dont vous voulez voir les statistiques')
      .setRequired(false)
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  try {
    if (!interaction.guildId) {
      return interaction.reply({ content: 'Cette commande doit être utilisée dans un serveur.', flags: MessageFlags.Ephemeral });
    }

    const targetUser = interaction.options.getUser('user') || interaction.user;

    const [totals, bonusRow] = await Promise.all([
      prisma.invite.aggregate({
        where: { guildId: interaction.guildId, inviterId: targetUser.id },
        _sum: { uses: true, left: true, fake: true }
      }),
      prisma.inviteBonus.findUnique({
        where: { guildId_userId: { guildId: interaction.guildId, userId: targetUser.id } }
      })
    ]);

    const uses = totals._sum.uses ?? 0;
    const left = totals._sum.left ?? 0;
    const fake = totals._sum.fake ?? 0;
    const bonus = bonusRow?.amount ?? 0;
    const total = uses - left - fake + bonus;

    const embed = new EmbedBuilder()
      .setColor('#0099ff')
      .setTitle('📊 Statistiques d\'invitations')
      .setDescription(`Voici les statistiques d'invitations de ${targetUser}:`)
      .addFields(
        { name: '📥 Invitations actives', value: `${total}`, inline: true },
        { name: '📋 Invitations totales', value: `${uses}`, inline: true },
        { name: '❌ Membres partis', value: `${left}`, inline: true },
        { name: '🤖 Comptes suspects', value: `${fake}`, inline: true },
        { name: '🎁 Invitations bonus', value: `${bonus}`, inline: true }
      )
      .setTimestamp();

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  } catch (error) {
    console.error('❌ Erreur dans la commande invites:', error);
    const payload = { content: '❌ Une erreur est survenue lors de l\'exécution de la commande.', flags: MessageFlags.Ephemeral } as const;
    if (interaction.replied || interaction.deferred) await interaction.followUp(payload).catch(() => {});
    else await interaction.reply(payload).catch(() => {});
  }
}
