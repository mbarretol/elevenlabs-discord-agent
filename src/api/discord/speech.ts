import opus from '@discordjs/opus';
import {
  AudioReceiveStream,
  EndBehaviorType,
  VoiceConnection,
  type VoiceConnectionState,
  VoiceConnectionDisconnectReason,
  VoiceConnectionStatus,
  entersState,
} from '@discordjs/voice';
import { logger } from '../../config/logger.js';
import { Agent } from '../elevenlabs/agent.js';
import { delay } from '../../utils/time.js';

/**
 * Handles speech processing for users in a voice channel.
 */
class SpeechHandler {
  private speakingUsers: Map<string, AudioReceiveStream>;
  private client: Agent;
  private decoder: opus.OpusEncoder;
  private connection: VoiceConnection;

  /**
   * @param client - ElevenLabs agent that receives PCM chunks.
   * @param connection - Active Discord voice connection to monitor.
   * @param sampleRate - PCM sample rate expected by ElevenLabs (defaults to 16 kHz).
   * @param channels - Number of channels to decode to (defaults to mono).
   */
  constructor(
    client: Agent,
    connection: VoiceConnection,
    sampleRate = 16000,
    channels = 1
  ) {
    this.speakingUsers = new Map();
    this.client = client;
    this.decoder = new opus.OpusEncoder(sampleRate, channels);
    this.connection = connection;
  }

  /**
   * Initializes the speech handler and sets up event listeners.
   * @returns {Promise<void>} A promise that resolves when initialization is complete.
   */
  async initialize(): Promise<void> {
    try {
      await this.client.connect();

      this.connection.receiver.speaking.on('start', (userId: string) => {
        this.handleUserSpeaking(userId);
      });

      this.connection.on('stateChange', this.handleConnectionStateChange);
    } catch (error) {
      logger.error(error, 'Error initializing speech handler');
    }
  }

  /**
   * Handles a user starting to speak.
   * @param {string} userId - The ID of the user who is speaking.
   */
  private handleUserSpeaking(userId: string): void {
    if (this.speakingUsers.has(userId)) return;

    this.createUserAudioStream(userId);
  }

  /**
   * Creates an audio stream for a user.
   * @param {string} userId - The ID of the user.
   * @returns {Promise<void>} A promise that resolves when the audio stream is created.
   */
  private async createUserAudioStream(userId: string): Promise<void> {
    try {
      const opusAudioStream: AudioReceiveStream = this.connection.receiver.subscribe(userId, {
        end: { behavior: EndBehaviorType.Manual },
      });

      this.speakingUsers.set(userId, opusAudioStream);

      for await (const opusBuffer of opusAudioStream) {
        this.processAudio(opusBuffer);
      }
    } catch (error) {
      logger.error(error, `Error subscribing to user audio: ${userId}`);
    }
  }

  /**
   * Processes the audio buffer received from a user.
   * @param {Buffer} opusBuffer - The audio buffer to process.
   */
  private processAudio(opusBuffer: Buffer): void {
    try {
      const pcm = this.decoder.decode(opusBuffer);
      this.client.appendInputAudio(pcm);
    } catch (error) {
      logger.error(error, 'Error processing audio for transcription');
    }
  }

  /**
   * Cleans up audio streams and disconnects the client.
   */
  private cleanup(): void {
    for (const audioStream of this.speakingUsers.values()) {
      audioStream.push(null);
      audioStream.destroy();
    }
    this.speakingUsers.clear();
    this.client.disconnect();
  }

  /**
   * Reacts to connection state changes, attempting recovery on transient disconnects.
   * @param _oldState - Previous voice connection state.
   * @param newState - Current voice connection state.
   */
  private handleConnectionStateChange = async (
    _oldState: VoiceConnectionState,
    newState: VoiceConnectionState
  ): Promise<void> => {
    if (newState.status === VoiceConnectionStatus.Disconnected) {
      logger.warn('Voice connection disconnected. Attempting to recover.');

      if (
        newState.reason === VoiceConnectionDisconnectReason.WebSocketClose &&
        newState.closeCode === 4014
      ) {
        try {
          await entersState(this.connection, VoiceConnectionStatus.Connecting, 5_000);
          logger.info('Voice connection recovered after 4014 close.');
          return;
        } catch (error) {
          logger.error(error, 'Failed to reconnect after 4014 close. Destroying connection.');
          this.connection.destroy();
          return;
        }
      }

      if (this.connection.rejoinAttempts < 5) {
        const attempt = this.connection.rejoinAttempts + 1;
        const delayMs = attempt * 5_000;
        logger.info(`Rejoining voice connection (attempt ${attempt}) in ${delayMs}ms.`);
        await delay(delayMs);
        this.connection.rejoin();
        return;
      }

      logger.warn('Max rejoin attempts reached. Destroying voice connection.');
      this.connection.destroy();
    } else if (newState.status === VoiceConnectionStatus.Destroyed) {
      logger.info('Voice connection destroyed. Cleaning up.');
      this.cleanup();
    }
  };
}

export { SpeechHandler };
