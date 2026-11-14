import { createAudioPlayer, getVoiceConnection, joinVoiceChannel } from '@discordjs/voice';
import { ChatInputCommandInteraction, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { SpeechHandler } from '../api/discord/speech.js';
import { Agent } from '../api/elevenlabs/agent.js';
import { getAgentUrl } from '../config/config.js';
import { logger } from '../config/logger.js';
import { createSearchDiscordMessagesTool } from '../tools/searchDiscordMessages.js';
import { createSoundboardTools } from '../tools/soundboard.js';
import { Embeds } from '../utils/embedHelper.js';

export const data = new SlashCommandBuilder()
  .setName('talk')
  .setDescription('Start a voice conversation.');

async function replyWithError(
  interaction: ChatInputCommandInteraction,
  message: string
): Promise<void> {
  await interaction.reply({
    embeds: [Embeds.error('Error', message)],
    flags: MessageFlags.Ephemeral,
  });
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.inCachedGuild()) {
    return replyWithError(interaction, 'This command can only be used within a guild.');
  }

  const voiceChannel = interaction.member.voice.channel;

  if (!voiceChannel) {
    return replyWithError(interaction, 'You need to be in a voice channel to use this command.');
  }

  if (getVoiceConnection(interaction.guildId)) {
    return replyWithError(interaction, 'Client is already in a voice channel.');
  }

  await interaction.deferReply();

  const connection = joinVoiceChannel({
    adapterCreator: voiceChannel.guild.voiceAdapterCreator,
    channelId: voiceChannel.id,
    guildId: voiceChannel.guild.id,
    selfDeaf: false,
    selfMute: false,
  });

  try {
    const audioPlayer = createAudioPlayer();
    connection.subscribe(audioPlayer);

    const agent = new Agent({
      url: getAgentUrl(),
      audioPlayer,
      tools: {
        search_discord_messages: createSearchDiscordMessagesTool(
          interaction.member,
          interaction.channelId
        ),
        ...createSoundboardTools(interaction.member, voiceChannel),
      },
    });
    await new SpeechHandler(agent, connection).initialize();

    await interaction.editReply({
      embeds: [Embeds.success('Connected', "Let's chat!")],
    });
  } catch (error) {
    logger.error(error, 'Failed to start ElevenLabs voice session');
    // A failed agent connection has already destroyed (and unregistered) the voice connection.
    getVoiceConnection(interaction.guildId)?.destroy();

    await interaction.editReply({
      embeds: [
        Embeds.error(
          'Voice Session Failed',
          "Couldn't start the live conversation. Please try again in a moment."
        ),
      ],
    });
  }
}
