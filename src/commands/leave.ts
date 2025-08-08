import { CommandInteraction, SlashCommandBuilder } from 'discord.js';
import { getVoiceConnection } from '@discordjs/voice';
import { logger } from '../config/logger.js';
import { Embeds } from '../utils/index.js';

/**
 * Represents the structure of the leave command using native SlashCommandBuilder.
 */
export const data = new SlashCommandBuilder()
  .setName('leave')
  .setDescription('Disconnects Voicebot from the voice channel.');

/**
 * Executes the leave command.
 *
 * @param {CommandInteraction} interaction - The interaction object representing the command execution.
 * @returns {Promise<void>}
 */
export async function execute(interaction: CommandInteraction): Promise<void> {
  try {
    await interaction.deferReply();
    const connection = getVoiceConnection(interaction.guildId!);
    const success = !!connection;
    if (connection) connection.destroy();

    if (success) {
      await interaction.editReply({
        embeds: [Embeds.success('Voice Channel Left', 'Successfully left the voice channel.')],
      });
    } else {
      await interaction.editReply({
        embeds: [Embeds.info('Not in Voice Channel', 'I was not in a voice channel.')],
      });
    }
  } catch (error) {
    logger.error(error, 'Error in leave command');

    await interaction.editReply({
      embeds: [Embeds.error('Error', 'An error occurred while leaving the voice channel.')],
    });
  }
}
