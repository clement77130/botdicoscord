import { Events, Guild } from 'discord.js';
import { cacheGuildInvites } from '../utils/inviteCache';

export const name = Events.GuildCreate;

export async function execute(guild: Guild) {
  await cacheGuildInvites(guild);
  guild.members.fetch().catch(() => {});
}
