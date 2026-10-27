import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits
} from 'discord.js';
import { prisma } from '../../utils/prisma';
import { getGroup, RobloxApiError } from '../../utils/roblox';
import { bindKind, bindRoleIds } from '../../utils/robloxConfig';

export const data = new SlashCommandBuilder()
  .setName('bind')
  .setDescription('Associer des rangs d\'un groupe Roblox à des rôles Discord (le panel permet plus d\'options)')
  .addSubcommand(sub =>
    sub
      .setName('group')
      .setDescription('Associer un ou plusieurs rangs d\'un groupe à un rôle')
      .addIntegerOption(o => o.setName('group_id').setDescription('ID du groupe Roblox').setRequired(true).setMinValue(1))
      .addRoleOption(o => o.setName('role').setDescription('Rôle Discord à donner').setRequired(true))
      .addIntegerOption(o =>
        o.setName('rank').setDescription('Rang exact (0 = non-membre du groupe)').setMinValue(0).setMaxValue(255))
      .addIntegerOption(o =>
        o.setName('min_rank').setDescription('Rang minimum (inclus)').setMinValue(0).setMaxValue(255))
      .addIntegerOption(o =>
        o.setName('max_rank').setDescription('Rang maximum (inclus)').setMinValue(0).setMaxValue(255)))
  .addSubcommand(sub => sub.setName('list').setDescription('Lister les associations'))
  .addSubcommand(sub =>
    sub
      .setName('remove')
      .setDescription('Supprimer une association')
      .addIntegerOption(o => o.setName('id').setDescription('Numéro de l\'association (voir /bind list)').setRequired(true).setMinValue(1)))
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .setDMPermission(false);

export async function execute(interaction: ChatInputCommandInteraction) {
  if (!interaction.inCachedGuild()) {
    return interaction.reply({ content: 'Cette commande doit être utilisée dans un serveur.', flags: MessageFlags.Ephemeral });
  }

  if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({
      content: 'Vous devez être administrateur pour utiliser cette commande.',
      flags: MessageFlags.Ephemeral
    });
  }

  const subcommand = interaction.options.getSubcommand();
  const guildId = interaction.guildId;

  if (subcommand === 'group') {
    const groupId = interaction.options.getInteger('group_id', true);
    const roleOption = interaction.options.getRole('role', true);
    const rank = interaction.options.getInteger('rank');
    const minRank = interaction.options.getInteger('min_rank');
    const maxRank = interaction.options.getInteger('max_rank');

    if (rank !== null && (minRank !== null || maxRank !== null)) {
      return interaction.reply({
        content: 'Utilisez soit `rank`, soit `min_rank` / `max_rank`, pas les deux.',
        flags: MessageFlags.Ephemeral
      });
    }
    if (minRank !== null && maxRank !== null && minRank > maxRank) {
      return interaction.reply({ content: '`min_rank` doit être inférieur ou égal à `max_rank`.', flags: MessageFlags.Ephemeral });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    let group;
    try {
      group = await getGroup(groupId);
    } catch (error) {
      const message = error instanceof RobloxApiError ? error.message : 'Erreur inconnue';
      return interaction.editReply({ content: `❌ ${message}. Réessayez dans quelques instants.` });
    }
    if (!group) return interaction.editReply({ content: `❌ Le groupe Roblox **${groupId}** est introuvable.` });

    const role = interaction.guild.roles.cache.get(roleOption.id);
    if (!role) return interaction.editReply({ content: '❌ Rôle introuvable.' });

    const isGroupBind = rank === null && minRank === null && maxRank === null;
    const bind = await prisma.robloxBind.create({
      data: {
        guildId,
        type: isGroupBind ? 'group' : 'rank',
        groupId: String(groupId),
        roleIds: JSON.stringify([role.id]),
        rank,
        minRank,
        maxRank
      }
    });

    const warning = role.editable
      ? ''
      : '\n⚠️ Ce rôle est au-dessus de mon rôle le plus élevé : je ne pourrai pas l\'attribuer. Montez mon rôle dans la liste.';

    return interaction.editReply({
      content: `✅ Association **#${bind.id}** créée : ${describeRule(group.name, rank, minRank, maxRank)} → ${role}.${warning}`,
      allowedMentions: { parse: [] }
    });
  }

  if (subcommand === 'list') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const binds = await prisma.robloxBind.findMany({ where: { guildId }, orderBy: { id: 'asc' } });
    if (binds.length === 0) return interaction.editReply({ content: 'Aucune association configurée. Utilisez `/bind group`.' });

    const names = new Map<string, string>();
    await Promise.all(
      [...new Set(binds.map(b => b.groupId))].map(async id => {
        try {
          const group = await getGroup(id);
          if (group) names.set(id, group.name);
        } catch {
          // On affichera simplement l'ID
        }
      })
    );

    const lines = binds.map(b => {
      const roles = bindRoleIds(b).map(id => `<@&${id}>`).join(' ') || '—';
      const kind = bindKind(b);
      if (kind === 'custom') return `**#${b.id}** — condition personnalisée → ${roles}`;
      if (kind === 'asset') return `**#${b.id}** — ${b.assetType ?? 'Objet'} ${b.assetId} → ${roles}`;
      return `**#${b.id}** — ${describeRule(names.get(b.groupId) ?? `Groupe ${b.groupId}`, b.rank, b.minRank, b.maxRank)} → ${roles}`;
    });

    const embed = new EmbedBuilder()
      .setColor('#0099ff')
      .setTitle('🔗 Associations Roblox')
      .setDescription(lines.join('\n').slice(0, 4000));

    return interaction.editReply({ embeds: [embed], allowedMentions: { parse: [] } });
  }

  if (subcommand === 'remove') {
    const id = interaction.options.getInteger('id', true);
    const deleted = await prisma.robloxBind.deleteMany({ where: { id, guildId } });
    return interaction.reply({
      content: deleted.count ? `✅ Association **#${id}** supprimée. Lancez \`/updateall\` pour retirer le rôle aux membres concernés.` : '❌ Association introuvable.',
      flags: MessageFlags.Ephemeral
    });
  }
}

function describeRule(groupName: string, rank: number | null, min: number | null, max: number | null): string {
  if (rank !== null) {
    return rank === 0 ? `**${groupName}** : non-membres` : `**${groupName}** : rang ${rank}`;
  }
  if (min !== null || max !== null) {
    return `**${groupName}** : rangs ${min ?? 1} à ${max ?? 255}`;
  }
  return `**${groupName}** : tous les membres`;
}
