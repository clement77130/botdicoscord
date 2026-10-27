import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder, MessageFlags } from 'discord.js';
import { prisma } from '../../utils/prisma';
import { getHeadshot, getUser, getUserByUsername, getUserGroups, RobloxApiError } from '../../utils/roblox';

export const data = new SlashCommandBuilder()
  .setName('whois')
  .setDescription('Voir le compte Roblox lié à un membre, ou les membres liés à un compte Roblox')
  .addUserOption(option =>
    option.setName('user').setDescription('Le membre Discord').setRequired(false)
  )
  .addStringOption(option =>
    option.setName('roblox').setDescription('Un pseudo Roblox').setRequired(false).setMinLength(3).setMaxLength(20)
  )
  .setDMPermission(false);

export async function execute(interaction: ChatInputCommandInteraction) {
  if (!interaction.guildId) {
    return interaction.reply({ content: 'Cette commande doit être utilisée dans un serveur.', flags: MessageFlags.Ephemeral });
  }

  await interaction.deferReply();

  const discordUser = interaction.options.getUser('user');
  const robloxName = interaction.options.getString('roblox');

  try {
    let robloxId: string;

    if (robloxName) {
      const found = await getUserByUsername(robloxName.trim());
      if (!found) return interaction.editReply({ content: `❌ Aucun compte Roblox nommé **${robloxName}**.` });
      robloxId = String(found.id);
    } else {
      const target = discordUser ?? interaction.user;
      const link = await prisma.robloxLink.findUnique({ where: { discordId: target.id } });
      if (!link) {
        return interaction.editReply({ content: `${target} n'a pas de compte Roblox lié (\`/verify\`).` });
      }
      robloxId = link.robloxId;
    }

    const [user, groups, headshot, links, config] = await Promise.all([
      getUser(robloxId),
      getUserGroups(robloxId),
      getHeadshot(robloxId),
      prisma.robloxLink.findMany({ where: { robloxId } }),
      prisma.robloxConfig.findUnique({ where: { guildId: interaction.guildId } })
    ]);

    if (!user) return interaction.editReply({ content: '❌ Ce compte Roblox est introuvable.' });

    const embed = new EmbedBuilder()
      .setColor('#0099ff')
      .setTitle(user.name)
      .setURL(`https://www.roblox.com/users/${user.id}/profile`)
      .addFields(
        { name: 'Pseudo affiché', value: user.displayName, inline: true },
        { name: 'ID Roblox', value: String(user.id), inline: true }
      );

    if (user.created) {
      embed.addFields({
        name: 'Compte créé',
        value: `<t:${Math.floor(new Date(user.created).getTime() / 1000)}:D>`,
        inline: true
      });
    }

    if (config?.mainGroupId) {
      const membership = groups.get(config.mainGroupId);
      embed.addFields({
        name: membership ? membership.groupName : 'Groupe principal',
        value: membership ? `${membership.roleName} (rang ${membership.rank})` : 'Non membre',
        inline: false
      });
    }

    embed.addFields({
      name: 'Compte(s) Discord lié(s)',
      value: links.length ? links.map(l => `<@${l.discordId}>`).join(', ') : 'Aucun',
      inline: false
    });

    if (headshot) embed.setThumbnail(headshot);
    if (user.isBanned) embed.setFooter({ text: '⚠️ Ce compte Roblox est banni' });

    await interaction.editReply({ embeds: [embed], allowedMentions: { parse: [] } });
  } catch (error) {
    const message = error instanceof RobloxApiError ? error.message : 'Erreur inconnue';
    console.error('❌ Erreur dans /whois:', error);
    await interaction.editReply({ content: `❌ ${message}.` });
  }
}
