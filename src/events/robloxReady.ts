import { Client, Events } from 'discord.js';
import { prisma } from '../utils/prisma';
import { syncGuild } from '../utils/robloxSync';
import { getOAuthConfig } from '../utils/robloxOAuth';
import { startWebServer } from '../web/server';

export const name = Events.ClientReady;
export const once = true;

export async function execute(client: Client) {
  // Serveur web : vérification Roblox (OAuth) et panel de configuration
  const oauth = getOAuthConfig();
  if (oauth) {
    startWebServer(client, oauth);
    console.log(`🧭 Panel de configuration : ${oauth.publicUrl}/dashboard`);
  } else {
    console.log('ℹ️ OAuth/panel non configurés (PUBLIC_URL, secrets Discord et Roblox) : /verify <pseudo> (méthode par code) uniquement');
  }

  // « Détection automatique » : remet à jour périodiquement les serveurs qui l'ont activée dans le panel.
  // Fréquence en minutes via ROBLOX_SYNC_MINUTES (60 par défaut, 0 = désactivé, 5 minimum).
  const configured = process.env.ROBLOX_SYNC_MINUTES;
  const minutes = configured === undefined || configured.trim() === '' ? 60 : Number(configured);
  if (!Number.isFinite(minutes) || minutes <= 0) return;

  const interval = Math.max(5, minutes);
  console.log(`🔄 Détection automatique Roblox : toutes les ${interval} minute(s) pour les serveurs qui l'ont activée`);

  setInterval(async () => {
    try {
      const enabled = await prisma.robloxConfig.findMany({ where: { autoDetection: true }, select: { guildId: true } });
      for (const { guildId } of enabled) {
        const guild = client.guilds.cache.get(guildId);
        if (!guild) continue;
        try {
          const summary = await syncGuild(guild);
          if (summary.total > 0) {
            console.log(`🔄 ${guild.name} : ${summary.total} membres, ${summary.changed} modifiés, ${summary.failed} erreurs`);
          }
        } catch (error) {
          console.error(`❌ Détection automatique échouée pour ${guild.name}:`, error);
        }
      }
    } catch (error) {
      console.error('❌ Détection automatique Roblox :', error);
    }
  }, interval * 60 * 1000);
}
