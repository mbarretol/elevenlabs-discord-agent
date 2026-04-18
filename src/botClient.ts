import { ChatInputCommandInteraction, Client, Collection } from 'discord.js';
import { readdirSync } from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { logger } from './config/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface Command {
  data: { name: string };
  execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
}

/**
 * Represents the bot client that handles commands.
 * @extends Client
 */
export class Bot extends Client {
  commands = new Collection<string, Command>();

  /**
   * Loads commands from the commands directory.
   * @returns {Promise<void>}
   */
  async loadCommands(): Promise<void> {
    const commandsPath = path.join(__dirname, 'commands');
    for (const file of readdirSync(commandsPath).filter(f => f.endsWith('.js'))) {
      const commandModuleUrl = pathToFileURL(path.join(commandsPath, file)).href;
      const command = await import(commandModuleUrl);
      if ('data' in command && 'execute' in command) {
        this.commands.set(command.data.name, command);
        logger.info(`Loaded command ${command.data.name}`);
      }
    }
  }

  /**
   * Handles the execution of a command based on the interaction.
   * @param {ChatInputCommandInteraction} interaction - The interaction containing the command.
   * @returns {Promise<void>}
   */
  async handleCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    try {
      const command = this.commands.get(interaction.commandName);
      if (!command) {
        logger.warn(`Received interaction for unloaded command: ${interaction.commandName}`);
        const response = {
          content: 'This command is currently unavailable. Please try again in a moment.',
          ephemeral: true,
        };
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp(response);
        } else {
          await interaction.reply(response);
        }
        return;
      }

      await command.execute(interaction);
    } catch (error) {
      logger.error(error, 'Command execution error');
      const response = { content: 'Command execution failed!', ephemeral: true };
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(response);
      } else {
        await interaction.reply(response);
      }
    }
  }
}
