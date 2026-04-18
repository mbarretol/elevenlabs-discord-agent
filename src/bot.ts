import { Events, GatewayIntentBits } from 'discord.js';
import { Bot } from './botClient.js';
import { DISCORD_CONFIG } from './config/config.js';
import { logger } from './config/logger.js';
import { deployCommands } from './utils/deployCommands.js';

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
