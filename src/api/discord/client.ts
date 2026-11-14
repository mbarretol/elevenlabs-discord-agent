import { Client, Events, GatewayIntentBits } from 'discord.js';
import { handleCommand } from '../../commands/index.js';
import { requireEnv } from '../../config/config.js';
import { logger } from '../../config/logger.js';

const token = requireEnv('DISCORD_BOT_TOKEN');
// Fail at startup rather than on the first /talk.
requireEnv('AGENT_ID');

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});

client.on(Events.InteractionCreate, interaction => {
  if (interaction.isChatInputCommand()) {
    void handleCommand(interaction);
  }
});

client.once(Events.ClientReady, () => {
  logger.info(`Ready! Logged in as ${client.user?.username}`);
});

await client.login(token);
