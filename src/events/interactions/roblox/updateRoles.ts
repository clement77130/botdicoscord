import { ButtonInteraction, MessageFlags } from 'discord.js';
import { updateMember } from '../../../utils/robloxSync';
import { RobloxApiError } from '../../../utils/roblox';
import { buildUpdateEmbed, summarizeUpdate } from '../../../utils/robloxEmbeds';
import { logRobloxAudit } from '../../../utils/robloxAudit';

// Bouton « Mettre à jour les rôles » de l'embed de vérification
export async function handleUpdateRoles(interaction: ButtonInteraction<'cached'>) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const result = await updateMember(interaction.member);
    await interaction.editReply({ embeds: [buildUpdateEmbed(result)] });

    const summary = summarizeUpdate(result);
    if (summary) {
      await logRobloxAudit(interaction.guild, 'Mise à jour', `<@${interaction.user.id}> : ${summary}`, {
        id: interaction.user.id,
        name: interaction.user.username
      });
    }
  } catch (error) {
    const message = error instanceof RobloxApiError ? error.message : 'Erreur inconnue';
    console.error('❌ Erreur du bouton de mise à jour Roblox:', error);
    await interaction.editReply({ content: `❌ ${message}.` });
  }
}
