import { REST, Routes } from 'discord.js';
import { commands } from '../commands/index.js';
import { DISCORD_CONFIG } from '../config/config.js';
import { logger } from '../config/logger.js';

export async function deployCommands(): Promise<void> {
  try {
    const rest = new REST().setToken(DISCORD_CONFIG.BOT_TOKEN);

    logger.info('Started refreshing application (/) commands.');

    await rest.put(Routes.applicationCommands(DISCORD_CONFIG.CLIENT_ID), {
      body: commands.map(command => command.data.toJSON()),
    });

    logger.info('Successfully reloaded application (/) commands.');
  } catch (error) {
    logger.error(error, 'Error loading commands or refreshing them');
  }
}
