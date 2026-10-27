import { Client, Collection, GatewayIntentBits, Partials } from 'discord.js';
import { config } from 'dotenv';
import { join } from 'path';
import { readdirSync } from 'fs';
import { initDatabase } from './utils/initDatabase';

declare module 'discord.js' {
  export interface Client {
    commands: Collection<string, any>;
  }
}

config();

process.on('unhandledRejection', error => console.error('Promesse rejetée non gérée:', error));

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildInvites
  ],
  // Indispensable : sans ça, guildMemberRemove n'est pas émis pour un membre absent du cache (après un redémarrage)
  partials: [Partials.GuildMember]
});

client.commands = new Collection();

const isCodeFile = (file: string) => (file.endsWith('.ts') || file.endsWith('.js')) && !file.endsWith('.d.ts');

async function loadCommands() {
  const commandsPath = join(__dirname, 'commands');
  for (const folder of readdirSync(commandsPath)) {
    const folderPath = join(commandsPath, folder);
    for (const file of readdirSync(folderPath).filter(isCodeFile)) {
      try {
        const command = await import(join(folderPath, file));
        if ('data' in command && 'execute' in command) {
          client.commands.set(command.data.name, command);
        }
      } catch (error) {
        console.error(`Erreur lors du chargement de la commande ${folder}/${file}:`, error);
      }
    }
  }
}

async function loadEvents() {
  const eventsPath = join(__dirname, 'events');
  for (const file of readdirSync(eventsPath).filter(isCodeFile)) {
    try {
      const event = await import(join(eventsPath, file));
      const run = (...args: any[]) =>
        Promise.resolve(event.execute(...args)).catch((error: unknown) =>
          console.error(`Erreur non gérée dans l'événement ${file}:`, error)
        );
      if (event.once) {
        client.once(event.name, run);
      } else {
        client.on(event.name, run);
      }
    } catch (error) {
      console.error(`Erreur lors du chargement de l'événement ${file}:`, error);
    }
  }
}

(async () => {
  try {
    await initDatabase();
    await loadCommands();
    await loadEvents();
    await client.login(process.env.TOKEN);
  } catch (error) {
    console.error('Erreur fatale lors de l\'initialisation:', error);
    process.exit(1);
  }
})();

export { client };
