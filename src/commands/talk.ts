import { AudioPlayer, joinVoiceChannel, getVoiceConnection } from '@discordjs/voice';
import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  TextChannel,
  GuildMember,
} from 'discord.js';
import { SpeechHandler } from '../api/discord/speech.js';
import { ElevenLabsConversationalAI } from '../api/elevenlabs/conversationalClient.js';
import { logger } from '../config/logger.js';
import { Embeds } from '../utils/embedHelper.js';

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

    if (!(interaction.member instanceof GuildMember) || !interaction.member.voice.channel) {
      await interaction.reply({
        embeds: [Embeds.error('Error', 'You need to be in a voice channel to use this command.')],
        ephemeral: true,
      });
      return;
    }

    if (getVoiceConnection(interaction.guildId!)) {
      await interaction.reply({
        embeds: [Embeds.error('Error', 'Bot is already in a voice channel.')],
        ephemeral: true,
      });
      return;
    }

    const connection = joinVoiceChannel({
      channelId: interaction.member.voice.channel.id,
      guildId: interaction.guildId!,
      adapterCreator: interaction.guild!.voiceAdapterCreator,
      selfDeaf: false,
      selfMute: false,
    });

    await interaction.reply({
      embeds: [Embeds.success('Connected', "Let's chat!")],
    });

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
