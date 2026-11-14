import {
  type ChatInputCommandInteraction,
  MessageFlags,
  type SlashCommandBuilder,
} from 'discord.js';
import { logger } from '../config/logger.js';
import * as leave from './leave.js';
import * as talk from './talk.js';

export interface Command {
  data: SlashCommandBuilder;
  execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
}

export const commands = [talk, leave] satisfies Command[];
export const commandMap = new Map(commands.map(command => [command.data.name, command]));

export async function handleCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  try {
    const command = commandMap.get(interaction.commandName);
    if (!command) throw new Error(`Unknown command: ${interaction.commandName}`);

    await command.execute(interaction);
  } catch (error) {
    logger.error(error, 'Command execution error');

    const response = {
      content: 'Command execution failed!',
      flags: MessageFlags.Ephemeral,
    } as const;
    const reply =
      interaction.replied || interaction.deferred
        ? interaction.followUp(response)
        : interaction.reply(response);
    // The interaction may have expired, in which case this reply fails too.
    await reply.catch(replyError => logger.error(replyError, 'Failed to report command error'));
  }
}
