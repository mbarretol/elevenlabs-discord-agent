import { REST, Routes } from 'discord.js';
import { readdirSync } from 'fs';
import path, { dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { DISCORD_CONFIG } from '../config/config.js';
import { logger } from '../config/logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Deploys application commands to the Discord API.
 * @async
 * @returns {Promise<void>} A promise that resolves when the commands are deployed.
 * @throws Will throw an error if there is an issue loading or refreshing commands.
 */

export async function deployCommands(): Promise<void> {
  const commands = [];
  const commandsPath = path.join(__dirname, '../commands');

  try {
    for (const file of readdirSync(commandsPath)) {
      if (!file.endsWith('.js')) continue;

      const commandModuleUrl = pathToFileURL(path.join(commandsPath, file)).href;
      const command = await import(commandModuleUrl);

      if (!('data' in command) || !('execute' in command)) {
        logger.info(`The command at ${file} is missing a required "data" or "execute" property.`);
        continue;
      }

      commands.push(command.data.toJSON());
    }

    const rest = new REST().setToken(DISCORD_CONFIG.BOT_TOKEN);

    logger.info('Started refreshing application (/) commands.');

    await rest.put(Routes.applicationCommands(DISCORD_CONFIG.CLIENT_ID), {
      body: commands,
    });

    logger.info('Successfully reloaded application (/) commands.');
  } catch (error) {
    logger.error(error, 'Error loading commands or refreshing them');
  }
}
