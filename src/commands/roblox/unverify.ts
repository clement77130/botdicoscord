import { SlashCommandBuilder, ChatInputCommandInteraction, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { prisma } from '../../utils/prisma';
import { updateMember } from '../../utils/robloxSync';
import { isStaff } from '../../utils/ticketUtils';
import { logRobloxAudit } from '../../utils/robloxAudit';

export const data = new SlashCommandBuilder()
  .setName('unverify')
  .setDescription('Délier votre compte Roblox de votre compte Discord')
  .addUserOption(option =>
    option.setName('user').setDescription('Membre à délier (staff uniquement)').setRequired(false)
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
        content: 'Vous n\'avez pas la permission de délier un autre membre.',
        flags: MessageFlags.Ephemeral
      });
    }
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const link = await prisma.robloxLink.findUnique({ where: { discordId: targetUser.id } });
  if (!link) {
    return interaction.editReply({ content: `${targetUser} n'a pas de compte Roblox lié.` });
  }

  await prisma.robloxLink.delete({ where: { discordId: targetUser.id } });
  await prisma.robloxVerification.deleteMany({ where: { discordId: targetUser.id } });

  // Retire les rôles liés à Roblox (et remet le rôle « non vérifié » s'il est configuré)
  const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
  if (member) await updateMember(member).catch(() => null);

  await logRobloxAudit(interaction.guild, 'Compte délié', `<@${targetUser.id}> n'est plus lié à ${link.robloxUsername}`, {
    id: interaction.user.id,
    name: interaction.user.username
  });

  await interaction.editReply({ content: `✅ Le compte Roblox **${link.robloxUsername}** a été délié de ${targetUser}.` });
}
