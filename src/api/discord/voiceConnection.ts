import { getVoiceConnection, joinVoiceChannel, VoiceConnection } from '@discordjs/voice';
import { CommandInteraction, GuildMember } from 'discord.js';
import { logger } from '../../config/index.js';
import { Embeds } from '../../utils/index.js';
import { ElevenLabsConversationalAI } from '../elevenlabs/conversationalClient.js';

/**
 * Manages voice connections for a Discord bot, handling connection and disconnection from voice channels.
 *
 * @class VoiceConnectionHandler
 * @property {CommandInteraction} interaction - The Discord command interaction instance
 * @property {VoiceConnection | null} connection - The current voice connection, if any
 */
class VoiceConnectionHandler {
  private interaction: CommandInteraction;

  /**
   * Creates an instance of VoiceConnectionHandler.
   * @param {CommandInteraction} interaction - The command interaction from Discord.
   */
  constructor(interaction: CommandInteraction) {
    this.interaction = interaction;
  }

  /**
   * Attempts to connect the bot to the voice channel of the user who invoked the command.
   * Validates the user's voice state and handles error cases with appropriate messages.
   *
   * @async
   * @returns {Promise<VoiceConnection | void>} The voice connection if successful, void if connection fails
   * @throws Will throw an error if connection fails unexpectedly
   */
  async connect(): Promise<VoiceConnection | void> {
    try {
      if (!this.isUserInVoiceChannel()) {
        return;
      }

      if (getVoiceConnection(this.interaction.guildId!)) {
        await this.interaction.reply({
          embeds: [Embeds.error('Error', 'Bot is already in a voice channel.')],
          ephemeral: true,
        });
        return;
      }

      const member = this.interaction.member as GuildMember;

      const connection = joinVoiceChannel({
        channelId: member.voice.channel!.id,
        guildId: this.interaction.guildId!,
        adapterCreator: member.guild.voiceAdapterCreator,
        selfDeaf: false,
        selfMute: false,
      });

      await this.interaction.reply({
        embeds: [Embeds.success('Connected', "Let's chat!")],
      });
      return connection;
    } catch (error) {
      logger.error(error, 'Error connecting to voice channel');
      await this.interaction.reply({
        embeds: [Embeds.error('Error', 'An error occurred while connecting to the voice channel.')],
        ephemeral: true,
      });
    }
  }

  /**
   * Validates that the user who invoked the command is in a voice channel.
   * Sends an error message if validation fails.
   *
   * @private
   * @returns {boolean} True if the member is in a voice channel, false otherwise
   */
  private isUserInVoiceChannel(): boolean {
    if (
      !(this.interaction.member instanceof GuildMember && this.interaction.member.voice.channel)
    ) {
      this.interaction.reply({
        embeds: [Embeds.error('Error', 'You need to be in a voice channel to use this command.')],
        ephemeral: true,
      });
      return false;
    }
    return true;
  }

  /**
   * Disconnects the bot from the current voice channel.
   * Destroys the voice connection if it exists.
   *
   * @async
   * @returns {Promise<boolean>} True if successfully disconnected, false if no connection existed or disconnection failed
   * @throws Will throw an error if guild ID is not defined
   */
  async disconnect(): Promise<boolean> {
    try {
      const connection = getVoiceConnection(this.interaction.guildId!);
      if (!connection) {
        return false;
      }

      connection.destroy();
      return true;
    } catch (error) {
      logger.error(error, 'Error disconnecting from voice channel');
      return false;
    }
  }
}

export { VoiceConnectionHandler };
