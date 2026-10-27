import { Client } from 'discord.js';
import { readdirSync } from 'fs';
import { join } from 'path';

export async function loadCommands(client: Client) {
  const foldersPath = join(__dirname, '..', 'commands');
  const commandFolders = readdirSync(foldersPath);

  for (const folder of commandFolders) {
    const commandsPath = join(foldersPath, folder);
    const commandFiles = readdirSync(commandsPath).filter(file => file.endsWith('.ts'));
    
    for (const file of commandFiles) {
      const filePath = join(commandsPath, file);
      const command = require(filePath);
      
      if ('data' in command && 'execute' in command) {
        client.commands.set(command.data.name, command);
      }
    }
  }
} 