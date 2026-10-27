import { EmbedBuilder } from 'discord.js';
import type { UpdateResult } from './robloxSync';

export function buildUpdateEmbed(result: UpdateResult, title = '🔄 Mise à jour Roblox'): EmbedBuilder {
  if (result.denied) {
    return new EmbedBuilder()
      .setColor('#e5484d')
      .setTitle('⛔ Compte refusé')
      .setDescription(
        `Votre compte Roblox est sur la liste de refus de ce serveur.\n**Raison :** ${result.denied.reason}`
      )
      .setTimestamp();
  }

  if (result.bypassed) {
    return new EmbedBuilder()
      .setColor('#808080')
      .setTitle(title)
      .setDescription('Ce membre possède un rôle « bypass » : ses rôles et son pseudo ne sont pas modifiés.')
      .setTimestamp();
  }

  const embed = new EmbedBuilder().setColor(result.warnings.length ? '#ffa500' : '#00b06f').setTitle(title).setTimestamp();

  if (result.linked) {
    embed.setDescription(
      `Compte Roblox : **${result.robloxUsername}** ([profil](https://www.roblox.com/users/${result.robloxId}/profile))`
    );
  } else {
    embed.setDescription('Ce membre n\'a pas de compte Roblox lié. Utilisez `/verify` pour en lier un.');
  }

  embed.addFields(
    {
      name: '➕ Rôles ajoutés',
      value: result.added.length ? result.added.map(id => `<@&${id}>`).join(', ') : 'Aucun',
      inline: true
    },
    {
      name: '➖ Rôles retirés',
      value: result.removed.length ? result.removed.map(id => `<@&${id}>`).join(', ') : 'Aucun',
      inline: true
    }
  );

  if (result.nickname) embed.addFields({ name: '✏️ Pseudo', value: result.nickname, inline: false });
  if (result.warnings.length) {
    embed.addFields({ name: '⚠️ Avertissements', value: result.warnings.join('\n').slice(0, 1000), inline: false });
  }

  return embed;
}

// Résumé texte des changements, pour le journal d'audit
export function summarizeUpdate(result: UpdateResult): string | null {
  const parts: string[] = [];
  if (result.added.length) parts.push(`+ ${result.added.map(id => `<@&${id}>`).join(' ')}`);
  if (result.removed.length) parts.push(`− ${result.removed.map(id => `<@&${id}>`).join(' ')}`);
  if (result.nickname) parts.push(`pseudo : ${result.nickname}`);
  return parts.length ? parts.join(' · ') : null;
}
