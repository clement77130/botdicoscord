import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder, MessageFlags } from 'discord.js';
import { prisma } from '../../utils/prisma';

export const data = new SlashCommandBuilder()
  .setName('leaderboard')
  .setDescription('Voir le classement des invitations');

interface Row {
  inviterId: string;
  uses: number;
  left: number;
  fake: number;
  bonus: number;
  total: number;
}

export async function execute(interaction: ChatInputCommandInteraction) {
  try {
    if (!interaction.guildId) {
      return interaction.reply({ content: 'Cette commande doit être utilisée dans un serveur.', flags: MessageFlags.Ephemeral });
    }

    const [grouped, bonuses] = await Promise.all([
      prisma.invite.groupBy({
        by: ['inviterId'],
        _sum: { uses: true, left: true, fake: true },
        where: { guildId: interaction.guildId }
      }),
      prisma.inviteBonus.findMany({ where: { guildId: interaction.guildId } })
    ]);

    const rows = new Map<string, Row>();
    const getRow = (id: string): Row => {
      let row = rows.get(id);
      if (!row) {
        row = { inviterId: id, uses: 0, left: 0, fake: 0, bonus: 0, total: 0 };
        rows.set(id, row);
      }
      return row;
    };

    for (const g of grouped) {
      const row = getRow(g.inviterId);
      row.uses = g._sum.uses ?? 0;
      row.left = g._sum.left ?? 0;
      row.fake = g._sum.fake ?? 0;
    }
    for (const b of bonuses) {
      getRow(b.userId).bonus = b.amount;
    }

    const top = [...rows.values()]
      .map(r => ({ ...r, total: r.uses - r.left - r.fake + r.bonus }))
      .filter(r => r.inviterId !== '0')
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);

    const embed = new EmbedBuilder().setColor('#0099ff').setTitle('📊 Classement des invitations');

    if (top.length === 0) {
      embed.setDescription('Aucune invitation n\'a été enregistrée pour le moment.');
      return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }

    // Mention <@id> : Discord affiche le nom même si le membre n'est pas en cache (sans notifier personne dans un embed)
    const lines = top.map((r, i) =>
      `${i + 1}. <@${r.inviterId}> - ${r.total} invitation${r.total > 1 ? 's' : ''} ` +
      `(${r.uses} total, ${r.left} partis, ${r.fake} suspects, ${r.bonus} bonus)`
    );

    embed.setDescription('Voici le classement des invitations :\n\n' + lines.join('\n'));
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  } catch (error) {
    console.error('❌ Erreur dans la commande leaderboard:', error);
    const payload = { content: '❌ Une erreur est survenue lors de l\'exécution de la commande.', flags: MessageFlags.Ephemeral } as const;
    if (interaction.replied || interaction.deferred) await interaction.followUp(payload).catch(() => {});
    else await interaction.reply(payload).catch(() => {});
  }
}
