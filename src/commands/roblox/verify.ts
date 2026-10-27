import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags
} from 'discord.js';
import { prisma } from '../../utils/prisma';
import { generateVerificationCode, getUserByUsername, RobloxApiError } from '../../utils/roblox';
import { SESSION_TTL_MS, createSession, getOAuthConfig, pendingInteractions } from '../../utils/robloxOAuth';

export const data = new SlashCommandBuilder()
  .setName('verify')
  .setDescription('Lier votre compte Roblox à votre compte Discord')
  .addStringOption(option =>
    option
      .setName('username')
      .setDescription('Pseudo Roblox (méthode par code). Laissez vide pour vous connecter avec Roblox')
      .setRequired(false)
      .setMinLength(3)
      .setMaxLength(20)
  )
  .setDMPermission(false);

export async function execute(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const username = interaction.options.getString('username')?.trim();

  // Sans pseudo : connexion Roblox (OAuth) comme RoWifi, si le serveur web est configuré
  if (!username) {
    const oauth = getOAuthConfig();
    if (!oauth || !interaction.guildId) {
      return interaction.editReply({
        content: 'Indiquez votre pseudo Roblox : `/verify username:VotrePseudo` (un code à coller dans votre profil vous sera donné).'
      });
    }

    const session = await createSession(interaction.user.id, interaction.guildId);
    pendingInteractions.set(session.id, interaction);
    setTimeout(() => pendingInteractions.delete(session.id), SESSION_TTL_MS).unref();

    const oauthEmbed = new EmbedBuilder()
      .setColor('#0099ff')
      .setTitle('🔗 Vérification de votre compte Roblox')
      .setDescription(
        'Cliquez sur le bouton ci-dessous pour vous connecter avec Discord puis avec Roblox.\n' +
        'Vos rôles et votre pseudo seront mis à jour automatiquement à la fin.\n\n' +
        'Le lien est personnel et expire dans 10 minutes. Ne le partagez avec personne.'
      );

    const linkRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setLabel('Se connecter avec Roblox').setStyle(ButtonStyle.Link).setURL(`${oauth.publicUrl}/verify/${session.id}`)
    );

    return interaction.editReply({ embeds: [oauthEmbed], components: [linkRow] });
  }

  let robloxUser;
  try {
    robloxUser = await getUserByUsername(username);
  } catch (error) {
    const message = error instanceof RobloxApiError ? error.message : 'Erreur inconnue';
    return interaction.editReply({ content: `❌ ${message}. Réessayez dans quelques instants.` });
  }

  if (!robloxUser) {
    return interaction.editReply({ content: `❌ Aucun compte Roblox trouvé avec le pseudo **${username}**.` });
  }

  const existing = await prisma.robloxLink.findUnique({ where: { discordId: interaction.user.id } });
  const code = generateVerificationCode();

  await prisma.robloxVerification.upsert({
    where: { discordId: interaction.user.id },
    create: {
      discordId: interaction.user.id,
      robloxId: String(robloxUser.id),
      robloxUsername: robloxUser.name,
      code,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000)
    },
    update: {
      robloxId: String(robloxUser.id),
      robloxUsername: robloxUser.name,
      code,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000)
    }
  });

  const embed = new EmbedBuilder()
    .setColor('#0099ff')
    .setTitle('🔗 Vérification de votre compte Roblox')
    .setDescription(
      `Compte à lier : **${robloxUser.name}** ([profil](https://www.roblox.com/users/${robloxUser.id}/profile))\n\n` +
      '1. Ouvrez votre profil Roblox et modifiez la section **À propos de moi**.\n' +
      '2. Collez exactement ce code dans la description :\n' +
      `\`\`\`${code}\`\`\`\n` +
      '3. Enregistrez, puis cliquez sur **J\'ai ajouté le code**.\n\n' +
      'Le code expire dans 10 minutes. Vous pourrez le retirer de votre profil ensuite.' +
      (existing ? `\n\n⚠️ Votre lien actuel (**${existing.robloxUsername}**) sera remplacé.` : '')
    );

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('roblox_verify_done').setLabel('J\'ai ajouté le code').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('roblox_verify_cancel').setLabel('Annuler').setStyle(ButtonStyle.Secondary)
  );

  await interaction.editReply({ embeds: [embed], components: [row] });
}
