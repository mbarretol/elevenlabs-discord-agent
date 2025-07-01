import { AudioPlayer } from '@discordjs/voice';
import { ChatInputCommandInteraction, SlashCommandBuilder, TextChannel } from 'discord.js';
import { SpeechHandler } from '../api/discord/speech.js';
import { ElevenLabsConversationalAI } from '../api/elevenlabs/conversationalClient.js';
import { VoiceConnectionHandler } from '../api/index.js';
import { logger } from '../config/logger.js';
import { Embeds } from '../utils/index.js';

export const data = new SlashCommandBuilder()
  .setName('talk')
  .setDescription('Unleash an auditory adventure with a voice that echoes from the digital realm.');

/**
 * Executes the talk command.
 *
 * @param {CommandInteraction} interaction - The interaction object representing the command execution.
 * @returns {Promise<void>}
 */
export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  try {
    if (!interaction.channel || !(interaction.channel instanceof TextChannel)) {
      await interaction.reply({
        embeds: [Embeds.error('Error', 'This command can only be used in text channels!')],
        ephemeral: true,
      });
      return;
    }

    const audioPlayer = new AudioPlayer();
    const elevenlabsConvClient = new ElevenLabsConversationalAI(audioPlayer, interaction.channel);
    const connectionHandler = new VoiceConnectionHandler(interaction);

    const connection = await connectionHandler.connect();
    if (!connection) {
      return;
    }

    connection.subscribe(audioPlayer);

    const speechHandler = new SpeechHandler(elevenlabsConvClient, connection);
    speechHandler.initialize();
  } catch (error) {
    logger.error(error, 'Something went wrong during voice mode');

    await interaction.reply({
      embeds: [Embeds.error('Error', 'An error occurred while starting the voice chat.')],
      ephemeral: true,
    });
  }
}
