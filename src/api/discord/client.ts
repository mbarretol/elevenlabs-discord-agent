import {
  ChatInputCommandInteraction,
  Client,
  Events,
  GatewayIntentBits,
  InteractionReplyOptions,
  MessageFlags,
} from 'discord.js';
import { commandMap } from '../../commands/index.js';
import { DISCORD_CONFIG } from '../../config/config.js';
import { logger } from '../../config/logger.js';
import { deployCommands } from '../../utils/deployCommands.js';

async function replyOrFollowUp(
  interaction: ChatInputCommandInteraction,
  response: InteractionReplyOptions
): Promise<void> {
  if (interaction.replied || interaction.deferred) {
    await interaction.followUp(response);
  } else {
    await interaction.reply(response);
  }
}

export async function handleCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  try {
    const command = commandMap.get(interaction.commandName);
    if (!command) {
      logger.warn(`Received interaction for unloaded command: ${interaction.commandName}`);
      const response: InteractionReplyOptions = {
        content: 'This command is currently unavailable. Please try again in a moment.',
        flags: MessageFlags.Ephemeral,
      };
      await replyOrFollowUp(interaction, response);
      return;
    }

    await command.execute(interaction);
  } catch (error) {
    logger.error(error, 'Command execution error');
    const response: InteractionReplyOptions = {
      content: 'Command execution failed!',
      flags: MessageFlags.Ephemeral,
    };
    await replyOrFollowUp(interaction, response);
  }
}

async function main(): Promise<void> {
  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
  });

  client.on(Events.InteractionCreate, interaction => {
    if (interaction.isChatInputCommand()) {
      void handleCommand(interaction);
    }
  });

  client.once(Events.ClientReady, async () => {
    await deployCommands();
    logger.info(`Ready! Logged in as ${client.user?.username}`);
  });

  await client.login(DISCORD_CONFIG.BOT_TOKEN);
}

if (import.meta.main) {
  main().catch(error => {
    logger.error(error, 'Discord client startup failed');
    process.exitCode = 1;
  });
}
