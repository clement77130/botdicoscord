import { Collection } from 'discord.js';
import type { Command } from './Command';

declare module 'discord.js' {
  interface Client {
    commands: Collection<string, Command>;
  }
} 