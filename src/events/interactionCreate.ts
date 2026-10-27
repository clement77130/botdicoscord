import { Events, Interaction, DiscordAPIError } from 'discord.js';
import * as ticketHandlers from './interactions/tickets';
import * as giveawayHandlers from './interactions/giveaways';
import * as commandHandlers from './interactions/commands';

export const name = Events.InteractionCreate;
export const once = false;

export async function execute(interaction: Interaction) {
  try {
    if (!interaction.inCachedGuild()) return;

    if (interaction.isCommand()) {
      await commandHandlers.handleCommand(interaction);
    } else if (interaction.isStringSelectMenu() && interaction.customId === 'ticket_create') {
      await ticketHandlers.handleSelect(interaction);
    } else if (interaction.isModalSubmit() && interaction.customId.startsWith('ticket_modal_')) {
      await ticketHandlers.handleCreate(interaction);
    } else if (interaction.isButton()) {
      if (interaction.customId === 'giveaway_enter') {
        return; 
      }
      if (interaction.customId.startsWith('ticket_')) {
        return; 
      }
    }
  } catch (error) {
    console.error('Erreur dans interactionCreate:', error);
    
    if (error instanceof DiscordAPIError) {
      if (error.code === 10062 || error.code === 40060) return;
    }

    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      try {
        await interaction.reply({
          content: 'Une erreur est survenue.',
          ephemeral: true
        });
      } catch (e) {
        console.error('Impossible de répondre à l\'interaction:', e);
      }
    }
  }
} 