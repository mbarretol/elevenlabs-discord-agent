import type { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import * as leave from './leave.js';
import * as talk from './talk.js';

export interface Command {
  data: SlashCommandBuilder;
  execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
}

export const commands = [talk, leave] satisfies Command[];
export const commandMap = new Map(commands.map(command => [command.data.name, command]));
