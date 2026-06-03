import { AudioPlayer, joinVoiceChannel, getVoiceConnection } from '@discordjs/voice';
import {
  ChannelType,
  ChatInputCommandInteraction,
  MessageFlags,
  SlashCommandBuilder,
} from 'discord.js';
import { SpeechHandler } from '../api/discord/speech.js';
import { Agent } from '../api/elevenlabs/agent.js';
import { logger } from '../config/logger.js';
import { createClientTools } from '../tools/clientTools.js';
import { Embeds } from '../utils/embedHelper.js';

const SEARCHABLE_CHANNEL_TYPES = new Set([
  ChannelType.GuildText,
  ChannelType.GuildAnnouncement,
  ChannelType.GuildForum,
  ChannelType.PublicThread,
  ChannelType.PrivateThread,
  ChannelType.AnnouncementThread,
]);

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

  const voiceConnection = getVoiceConnection(interaction.guildId);

  if (voiceConnection) {
    return replyWithError(interaction, 'Client is already in a voice channel.');
  }

  await interaction.deferReply();

  let cleanup = () => {};

  try {
    const audioPlayer = new AudioPlayer();
    const agent = new Agent(audioPlayer, {
      clientTools: createClientTools({
        discordMessageSearch: {
          rest: interaction.client.rest,
          guildId: interaction.guildId,
          channelId: interaction.channelId,
          resolveChannelId: channelName => {
            const normalizedName = normalizeChannelName(channelName);
            const channel = interaction.guild.channels.cache.find(
              channel =>
                SEARCHABLE_CHANNEL_TYPES.has(channel.type) &&
                'name' in channel &&
                normalizeChannelName(channel.name) === normalizedName
            );

            return channel?.id;
          },
        },
      }),
    });
    const connection = joinVoiceChannel({
      adapterCreator: voiceChannel.guild.voiceAdapterCreator,
      channelId: voiceChannel.id,
      guildId: voiceChannel.guild.id,
      selfDeaf: false,
      selfMute: false,
    });

    cleanup = () => {
      connection.destroy();
      audioPlayer.stop();
      agent.disconnect();
    };

    connection.subscribe(audioPlayer);
    await new SpeechHandler(agent, connection).initialize();

    await interaction.editReply({
      embeds: [Embeds.success('Connected', "Let's chat!")],
    });
  } catch (error) {
    cleanup();
    logger.error(error, 'Failed to start ElevenLabs voice session');

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

function normalizeChannelName(channelName: string): string {
  return channelName.trim().replace(/^#/, '').toLowerCase();
}
