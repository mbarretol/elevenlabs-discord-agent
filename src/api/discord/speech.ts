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
 * Streams Discord voice packets to the ElevenLabs agent and keeps per-user
 * receive streams healthy while the voice connection is active.
 */
class SpeechHandler {
  private speakingUsers: Map<string, AudioReceiveStream>;
  private client: Agent;
  private decoder: opus.OpusEncoder;
  private connection: VoiceConnection;
  private speakingListener?: (userId: string) => void;

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
   * Connects to ElevenLabs, then wires up voice connection event listeners so
   * we can subscribe to users as they begin speaking.
   */
  async initialize(): Promise<void> {
    await this.client.connect();

    this.speakingListener = (userId: string) => {
      this.handleUserSpeaking(userId);
    };

    this.connection.receiver.speaking.on('start', this.speakingListener);
    this.connection.on('stateChange', this.handleConnectionStateChange);
  }

  /**
   * Creates a receive stream the first time a user speaks during the session.
   * Subsequent speaking events reuse the existing subscription.
   */
  private handleUserSpeaking(userId: string): void {
    if (this.speakingUsers.has(userId)) return;

    this.createUserAudioStream(userId);
  }

  /**
   * Subscribes to a user's Opus stream and forwards decoded audio to ElevenLabs
   * until the stream ends or errors.
   */
  private async createUserAudioStream(userId: string): Promise<void> {
    try {
      const opusAudioStream: AudioReceiveStream = this.connection.receiver.subscribe(userId, {
        end: { behavior: EndBehaviorType.Manual },
      });

      this.registerUserStream(userId, opusAudioStream);

      for await (const opusBuffer of opusAudioStream) {
        this.processAudio(opusBuffer);
      }
    } catch (error) {
      logger.error(error, `Error subscribing to user audio: ${userId}`);
    } finally {
      this.removeUserStream(userId);
    }
  }

  /**
   * Decodes an Opus frame and forwards the PCM payload to the agent.
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
   * Detaches listeners, tears down active receive streams, and closes the
   * ElevenLabs session.
   */
  private cleanup(): void {
    if (this.speakingListener) {
      this.connection.receiver.speaking.off('start', this.speakingListener);
      this.speakingListener = undefined;
    }

    this.connection.off('stateChange', this.handleConnectionStateChange);

    for (const userId of Array.from(this.speakingUsers.keys())) {
      this.removeUserStream(userId);
    }
    this.client.disconnect();
  }

  /**
   * Tracks the receive stream for a user and attaches once-only lifecycle
   * handlers so we can dispose it when it ends.
   */
  private registerUserStream(userId: string, stream: AudioReceiveStream): void {
    this.speakingUsers.set(userId, stream);

    stream.once('end', () => {
      this.removeUserStream(userId);
    });

    stream.once('close', () => {
      this.removeUserStream(userId);
    });

    stream.once('error', error => {
      logger.error(error, `Audio stream error for user: ${userId}`);
      this.removeUserStream(userId);
    });
  }

  /**
   * Removes the stored stream for the user and destroys the underlying
   * `AudioReceiveStream`.
   */
  private removeUserStream(userId: string): void {
    const stream = this.speakingUsers.get(userId);
    if (!stream) return;

    this.speakingUsers.delete(userId);

    stream.removeAllListeners();
    try {
      stream.destroy();
    } catch (error) {
      logger.debug(error, `Error destroying audio stream for user: ${userId}`);
    }
  }

  /**
   * Reacts to connection state changes, attempting limited reconnects before
   * giving up and cleaning up resources.
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
