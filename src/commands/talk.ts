import { AudioPlayer, joinVoiceChannel, getVoiceConnection } from '@discordjs/voice';
import { ChannelType, ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import { SpeechHandler } from '../api/discord/speech.js';
import { Agent } from '../api/elevenlabs/conversationalClient.js';
import { ToolRegistry } from '../api/elevenlabs/tools/toolRegistry.js';
import { createTavilyTool } from '../api/elevenlabs/tools/tavilyTool.js';
import { logger } from '../config/logger.js';
import { Embeds } from '../utils/embedHelper.js';

export const data = new SlashCommandBuilder()
  .setName('talk')
  .setDescription('Unleash an auditory adventure with a voice that echoes from the digital realm.');

/**
 * Executes the talk command.
 *
 * @param {ChatInputCommandInteraction} interaction - The interaction object representing the command execution.
 * @returns {Promise<void>}
 */
export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const safeReply = async (payload: Parameters<typeof interaction.reply>[0]) => {
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp(payload);
    } else {
      await interaction.reply(payload);
    }
  };

  const replyWithError = async (message: string) =>
    safeReply({ embeds: [Embeds.error('Error', message)], ephemeral: true });

  try {
    if (!interaction.inCachedGuild()) {
      await replyWithError('This command can only be used within a guild.');
      return;
    }

    if (!interaction.channel || interaction.channel.type !== ChannelType.GuildText) {
      await replyWithError('This command can only be used in text channels.');
      return;
    }

    const textChannel = interaction.channel;
    const voiceChannel = interaction.member.voice.channel;

    if (!voiceChannel) {
      await replyWithError('You need to be in a voice channel to use this command.');
      return;
    }

    if (getVoiceConnection(interaction.guildId!)) {
      await replyWithError('Bot is already in a voice channel.');
      return;
    }

    const audioPlayer = new AudioPlayer();
    const toolRegistry = new ToolRegistry();
    toolRegistry.register('web_search', createTavilyTool(textChannel));
    const agent = new Agent(audioPlayer, toolRegistry);

    const connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: interaction.guildId!,
      adapterCreator: interaction.guild.voiceAdapterCreator,
      selfDeaf: false,
      selfMute: false,
    });

    connection.subscribe(audioPlayer);

    await interaction.reply({
      embeds: [Embeds.success('Connected', "Let's chat!")],
    });

    const speechHandler = new SpeechHandler(agent, connection);
    await speechHandler.initialize();
  } catch (error) {
    logger.error(error, 'Something went wrong during voice mode');

    await safeReply({
      embeds: [Embeds.error('Error', 'An error occurred while starting the voice chat.')],
      ephemeral: true,
    });
  }
}
