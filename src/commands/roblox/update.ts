import { SlashCommandBuilder, ChatInputCommandInteraction, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { updateMember } from '../../utils/robloxSync';
import { RobloxApiError } from '../../utils/roblox';
import { buildUpdateEmbed, summarizeUpdate } from '../../utils/robloxEmbeds';
import { logRobloxAudit } from '../../utils/robloxAudit';
import { isStaff } from '../../utils/ticketUtils';

export const data = new SlashCommandBuilder()
  .setName('update')
  .setDescription('Mettre à jour vos rôles et votre pseudo selon votre compte Roblox')
  .addUserOption(option =>
    option.setName('user').setDescription('Membre à mettre à jour (staff uniquement)').setRequired(false)
  )
  .setDMPermission(false);

export async function execute(interaction: ChatInputCommandInteraction) {
  if (!interaction.inCachedGuild()) {
    return interaction.reply({ content: 'Cette commande doit être utilisée dans un serveur.', flags: MessageFlags.Ephemeral });
  }

  const targetUser = interaction.options.getUser('user') ?? interaction.user;

  if (targetUser.id !== interaction.user.id) {
    const allowed =
      interaction.memberPermissions.has(PermissionFlagsBits.ManageRoles) || (await isStaff(interaction.member));
    if (!allowed) {
      return interaction.reply({
        content: 'Vous n\'avez pas la permission de mettre à jour un autre membre.',
        flags: MessageFlags.Ephemeral
      });
    }
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
  if (!member) return interaction.editReply({ content: 'Membre introuvable sur ce serveur.' });

  try {
    const result = await updateMember(member);
    await interaction.editReply({ embeds: [buildUpdateEmbed(result)] });

    const summary = summarizeUpdate(result);
    if (summary) {
      await logRobloxAudit(interaction.guild, 'Mise à jour', `<@${member.id}> : ${summary}`, {
        id: interaction.user.id,
        name: interaction.user.username
      });
    }
  } catch (error) {
    const message = error instanceof RobloxApiError ? error.message : 'Erreur inconnue';
    console.error('❌ Erreur dans /update:', error);
    await interaction.editReply({ content: `❌ ${message}.` });
  }
}
