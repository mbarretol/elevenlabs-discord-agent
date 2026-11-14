import { REST, Routes } from 'discord.js';
import { commands } from './commands/index.js';
import { requireEnv } from './config/config.js';
import { logger } from './config/logger.js';

const rest = new REST().setToken(requireEnv('DISCORD_BOT_TOKEN'));

await rest.put(Routes.applicationCommands(requireEnv('DISCORD_CLIENT_ID')), {
  body: commands.map(command => command.data.toJSON()),
});

logger.info('Deployed application (/) commands.');
