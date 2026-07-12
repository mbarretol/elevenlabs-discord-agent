import { REST, Routes } from 'discord.js';
import { commands } from '../commands/index.js';
import { DISCORD_CONFIG } from '../config/config.js';
import { logger } from '../config/logger.js';

export async function deployCommands(): Promise<void> {
  const rest = new REST().setToken(DISCORD_CONFIG.BOT_TOKEN);

  logger.info('Started refreshing application (/) commands.');

  await rest.put(Routes.applicationCommands(DISCORD_CONFIG.CLIENT_ID), {
    body: commands.map(command => command.data.toJSON()),
  });

  logger.info('Successfully reloaded application (/) commands.');
}

if (import.meta.main) {
  deployCommands().catch(error => {
    logger.error(error, 'Failed to deploy application commands');
    process.exitCode = 1;
  });
}
