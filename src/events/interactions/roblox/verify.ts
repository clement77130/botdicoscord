import { ButtonInteraction, EmbedBuilder } from 'discord.js';
import { prisma } from '../../../utils/prisma';
import { getUser, normalizeText, RobloxApiError } from '../../../utils/roblox';
import { updateMember } from '../../../utils/robloxSync';
import { buildUpdateEmbed, summarizeUpdate } from '../../../utils/robloxEmbeds';
import { logRobloxAudit } from '../../../utils/robloxAudit';

export async function handleVerifyDone(interaction: ButtonInteraction<'cached'>) {
  await interaction.deferUpdate();

  const pending = await prisma.robloxVerification.findUnique({ where: { discordId: interaction.user.id } });

  if (!pending || pending.expiresAt.getTime() < Date.now()) {
    if (pending) await prisma.robloxVerification.delete({ where: { discordId: interaction.user.id } });
    return interaction.editReply({
      content: '❌ La vérification a expiré. Relancez `/verify`.',
      embeds: [],
      components: []
    });
  }

  let user;
  try {
    user = await getUser(pending.robloxId);
  } catch (error) {
    const message = error instanceof RobloxApiError ? error.message : 'Erreur inconnue';
    return interaction.editReply({ content: `❌ ${message}. Réessayez dans quelques instants.` });
  }

  if (!user) {
    await prisma.robloxVerification.delete({ where: { discordId: interaction.user.id } });
    return interaction.editReply({ content: '❌ Ce compte Roblox est introuvable.', embeds: [], components: [] });
  }

  if (!normalizeText(user.description ?? '').includes(normalizeText(pending.code))) {
    return interaction.editReply({
      content:
        '❌ Code introuvable dans la description de votre profil. Vérifiez qu\'il est bien enregistré ' +
        '(quelques secondes peuvent être nécessaires) puis recliquez sur le bouton.'
    });
  }

  await prisma.robloxLink.upsert({
    where: { discordId: interaction.user.id },
    create: { discordId: interaction.user.id, robloxId: pending.robloxId, robloxUsername: user.name },
    update: { robloxId: pending.robloxId, robloxUsername: user.name, linkedAt: new Date() }
  });
  await prisma.robloxVerification.delete({ where: { discordId: interaction.user.id } });

  const success = new EmbedBuilder()
    .setColor('#00b06f')
    .setTitle('✅ Compte vérifié')
    .setDescription(`Votre compte Discord est maintenant lié à **${user.name}**.`);

  const embeds = [success];
  try {
    const result = await updateMember(interaction.member);
    embeds.push(buildUpdateEmbed(result, '🔄 Rôles et pseudo mis à jour'));
    await logRobloxAudit(
      interaction.guild,
      'Compte vérifié',
      `<@${interaction.user.id}> lié à ${user.name} (code)${summarizeUpdate(result) ? ' — ' + summarizeUpdate(result) : ''}`,
      { id: interaction.user.id, name: interaction.user.username }
    );
  } catch (error) {
    const message = error instanceof RobloxApiError ? error.message : 'Erreur inconnue';
    success.setFooter({ text: `Compte lié, mais la mise à jour a échoué : ${message}. Utilisez /update.` });
  }

  await interaction.editReply({ content: '', embeds, components: [] });
}

export async function handleVerifyCancel(interaction: ButtonInteraction<'cached'>) {
  await prisma.robloxVerification.deleteMany({ where: { discordId: interaction.user.id } });
  await interaction.update({ content: 'Vérification annulée.', embeds: [], components: [] });
}
