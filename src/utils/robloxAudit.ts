import { EmbedBuilder, Guild } from 'discord.js';
import { prisma } from './prisma';

export interface AuditActor {
  id?: string | null;
  name?: string | null;
}

// Enregistre une action dans le journal d'audit et l'envoie dans le salon de logs Roblox s'il est configuré
export async function logRobloxAudit(guild: Guild, action: string, details: string, actor?: AuditActor): Promise<void> {
  try {
    await prisma.robloxAuditLog.create({
      data: {
        guildId: guild.id,
        actorId: actor?.id ?? null,
        actorName: actor?.name ?? null,
        action,
        details: details.slice(0, 1000)
      }
    });

    // Conserve les 1000 dernières entrées par serveur
    const old = await prisma.robloxAuditLog.findMany({
      where: { guildId: guild.id },
      orderBy: { id: 'desc' },
      skip: 1000,
      take: 1,
      select: { id: true }
    });
    if (old.length) await prisma.robloxAuditLog.deleteMany({ where: { guildId: guild.id, id: { lte: old[0].id } } });

    const config = await prisma.robloxConfig.findUnique({ where: { guildId: guild.id }, select: { logChannelId: true } });
    if (!config?.logChannelId) return;

    const channel = guild.channels.cache.get(config.logChannelId);
    if (!channel?.isTextBased() || !('send' in channel)) return;

    const embed = new EmbedBuilder()
      .setColor('#0099ff')
      .setTitle(`🔗 ${action}`)
      .setDescription(details.slice(0, 1000))
      .setTimestamp();
    if (actor?.name) embed.setFooter({ text: actor.name });

    await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
  } catch (error) {
    console.error('❌ Impossible d\'écrire dans le journal d\'audit Roblox:', error);
  }
}
