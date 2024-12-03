import {
  ChatInputCommandInteraction,
  Client,
  Collection,
  Events,
  GatewayIntentBits,
} from 'discord.js';
import { readdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { DISCORD_CONFIG, logger } from './config/index.js';
import { deployCommands } from './utils/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface Command {
  data: { name: string };
  execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
}

/**
 * Represents the bot client that handles commands.
 * @extends Client
 */
class Bot extends Client {
  commands = new Collection<string, Command>();

  /**
   * Loads commands from the commands directory.
   * @returns {Promise<void>}
   */
  async loadCommands(): Promise<void> {
    const commandsPath = path.join(__dirname, 'commands');
    for (const file of readdirSync(commandsPath).filter(f => f.endsWith('.js'))) {
      const command = await import(`file://${path.join(commandsPath, file)}`);
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
      await this.commands.get(interaction.commandName)?.execute(interaction);
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

const bot = new Bot({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });

bot.on(Events.InteractionCreate, interaction => {
  if (interaction.isChatInputCommand()) {
    bot.handleCommand(interaction);
  }
});

bot.once(Events.ClientReady, async () => {
  await deployCommands();
  await bot.loadCommands();
  logger.info(`Ready! Logged in as ${bot.user?.username}`);
});

bot.login(DISCORD_CONFIG.BOT_TOKEN);
