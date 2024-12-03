import opus from '@discordjs/opus';
import { AudioReceiveStream, EndBehaviorType, VoiceConnection } from '@discordjs/voice';
import { logger } from '../../config/index.js';
import { ElevenLabsConversationalAI } from '../index.js';

/**
 * Handles speech processing for users in a voice channel.
 */
class SpeechHandler {
  private speakingUsers: Map<string, AudioReceiveStream>;
  private client: ElevenLabsConversationalAI;
  private decoder: opus.OpusEncoder;
  private connection: VoiceConnection;

  constructor(
    client: ElevenLabsConversationalAI,
    connection: VoiceConnection,
    sampleRate: number = 16000,
    channels: number = 1
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
        this.handleUserSpeaking(userId, this.connection);
      });

      this.connection.on('stateChange', (oldState, newState) => {
        if (newState.status === 'disconnected' || newState.status === 'destroyed') {
          logger.info('Voice connection disconnected or destroyed. Cleaning up.');
          this.cleanup();
        }
      });
    } catch (error) {
      logger.error(error, 'Error initializing speech handler');
    }
  }

  /**
   * Handles a user starting to speak.
   * @param {string} userId - The ID of the user who is speaking.
   * @param {VoiceConnection} connection - The voice connection.
   * @returns {void}
   */
  private handleUserSpeaking(userId: string, connection: VoiceConnection): void {
    if (this.speakingUsers.has(userId)) return;

    this.createUserAudioStream(userId, connection);
  }

  /**
   * Creates an audio stream for a user.
   * @param {string} userId - The ID of the user.
   * @param {VoiceConnection} connection - The voice connection.
   * @returns {Promise<void>} A promise that resolves when the audio stream is created.
   */
  private async createUserAudioStream(userId: string, connection: VoiceConnection): Promise<void> {
    try {
      const opusAudioStream: AudioReceiveStream = connection.receiver.subscribe(userId, {
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
   * @returns {void}
   */
  private processAudio(opusBuffer: Buffer): void {
    try {
      const pcmBuffer = this.decoder.decode(opusBuffer);
      this.client.appendInputAudio(pcmBuffer);
    } catch (error) {
      logger.error(error, 'Error processing audio for transcription');
    }
  }

  /**
   * Cleans up audio streams and disconnects the client.
   * @returns {void}
   */
  private cleanup(): void {
    for (const audioStream of this.speakingUsers.values()) {
      audioStream.push(null);
      audioStream.destroy();
    }
    this.speakingUsers.clear();
    this.client.disconnect();
  }
}

export { SpeechHandler };
