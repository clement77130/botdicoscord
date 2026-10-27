import { Client } from 'discord.js';
import { readdirSync } from 'fs';
import { join } from 'path';

export async function loadEvents(client: Client) {
  const eventsPath = join(__dirname, '..', 'events');
  const eventFiles = readdirSync(eventsPath).filter(file => file.endsWith('.ts'));

  for (const file of eventFiles) {
    const filePath = join(eventsPath, file);
    const event = require(filePath);
    
    if (event.once) {
      client.once(event.name, (...args) => event.execute(...args));
    } else {
      client.on(event.name, (...args) => event.execute(...args));
    }
  }
} 