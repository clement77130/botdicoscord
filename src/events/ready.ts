import { Events, Client, TextChannel, EmbedBuilder } from 'discord.js';
import { prisma } from '../utils/prisma';
import { cacheGuildInvites } from '../utils/inviteCache';


export const name = Events.ClientReady;
export const once = true;

export async function execute(client: Client) {
  try {
    console.log(`🟢 Connecté en tant que ${client.user?.tag}`);

    // Snapshot des invitations + remplissage du cache des membres (nécessaire pour guildMemberRemove après un redémarrage)
    for (const guild of client.guilds.cache.values()) {
      await cacheGuildInvites(guild);
      guild.members.fetch().catch(error =>
        console.warn(`⚠️ Impossible de charger les membres de ${guild.name}:`, error.message)
      );
    }

    setInterval(async () => {
      const now = new Date();
      const giveaways = await prisma.giveaway.findMany({
        where: {
          endTime: {
            lte: now
          },
          ended: false
        },
        include: {
          participants: true
        }
      });

      for (const giveaway of giveaways) {
        try {
          if (giveaway.ended) continue;

          const channel = await client.channels.fetch(giveaway.channelId);
          if (!channel?.isTextBased()) continue;

          const message = await channel.messages.fetch(giveaway.messageId).catch(() => null);
          if (!message) {
            await prisma.giveaway.update({
              where: { id: giveaway.id },
              data: { ended: true }
            });
            continue;
          }

          const winners = [];
          const participantsCopy = [...giveaway.participants];
          
          for (let i = 0; i < Math.min(giveaway.winners, participantsCopy.length); i++) {
            const winnerIndex = Math.floor(Math.random() * participantsCopy.length);
            winners.push(participantsCopy.splice(winnerIndex, 1)[0]);
          }

          const winnersList = await Promise.all(
            winners.map(async (winner) => {
              const user = await client.users.fetch(winner.userId);
              return user.toString();
            })
          );

          const endEmbed = new EmbedBuilder()
            .setColor('#FF69B4')
            .setTitle('🎉 Giveaway Terminé!')
            .setDescription(
              `${giveaway.description}\n\n` +
              `**Gagnants:** ${winnersList.length > 0 ? winnersList.join(', ') : 'Aucun gagnant'}\n` +
              `**Nombre de participants:** ${giveaway.participants.length}\n` +
              `**Terminé:** <t:${Math.floor(giveaway.endTime.getTime() / 1000)}:R>`
            )
            .setTimestamp();

          await message.edit({
            embeds: [endEmbed],
            components: [] 
          });

          if (winnersList.length > 0) {
            const congratsMessage = `Félicitations! Vous avez gagné le giveaway **${giveaway.prize}**!`;
            winners.forEach(async (winner) => {
              const user = await client.users.fetch(winner.userId);
              user.send(congratsMessage).catch(() => {});
            });
          }

          await prisma.giveaway.update({
            where: { id: giveaway.id },
            data: { ended: true }
          });

        } catch (error) {
          console.error(`Erreur lors de la fin du giveaway ${giveaway.id}:`, error);
        }
      }
    }, 1000); // Vérifier toutes les secondes
  } catch (error) {
    console.error('❌ Erreur dans l\'événement ready:', error);
  }
} 