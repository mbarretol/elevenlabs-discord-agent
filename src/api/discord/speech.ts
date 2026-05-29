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

interface CodedError extends Error {
  code?: string;
}

/**
 * Streams Discord voice packets to the ElevenLabs agent and keeps per-user
 * receive streams healthy while the voice connection is active.
 */
class SpeechHandler {
  private speakingUsers: Map<string, AudioReceiveStream>;
  private activeSpeakerId: string | null;
  private isCleaningUp: boolean;
  private client: Agent;
  private decoder: opus.OpusEncoder;
  private connection: VoiceConnection;
  private speakingStartListener?: (userId: string) => void;
  private agentDisconnectListener?: () => void;

  /**
   * @param client - ElevenLabs agent that receives PCM chunks.
   * @param connection - Active Discord voice connection to monitor.
   * @param sampleRate - PCM sample rate expected by ElevenLabs (defaults to 16 kHz).
   * @param channels - Number of channels to decode to (defaults to mono).
   */
  constructor(client: Agent, connection: VoiceConnection, sampleRate = 16000, channels = 1) {
    this.speakingUsers = new Map();
    this.activeSpeakerId = null;
    this.isCleaningUp = false;
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

    this.speakingStartListener = (userId: string) => {
      this.handleUserSpeaking(userId);
    };
    this.agentDisconnectListener = () => {
      logger.warn('ElevenLabs agent disconnected. Destroying voice connection.');
      this.connection.destroy();
    };

    this.connection.receiver.speaking.on('start', this.speakingStartListener);
    this.connection.on('stateChange', this.handleConnectionStateChange);
    this.client.on('disconnect', this.agentDisconnectListener);
  }

  /**
   * Creates a receive stream the first time a user speaks during the session.
   * Subsequent speaking events reuse the existing subscription.
   */
  private handleUserSpeaking(userId: string): void {
    if (this.isCleaningUp || this.speakingUsers.has(userId)) return;
    if (this.activeSpeakerId && this.activeSpeakerId !== userId) return;

    this.activeSpeakerId = userId;
    this.createUserAudioStream(userId);
  }

  /**
   * Subscribes to a user's Opus stream and forwards decoded audio to ElevenLabs
   * until the voice session is cleaned up or the stream errors.
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
      if (!this.isCleaningUp && !this.isPrematureCloseError(error)) {
        logger.error(error, `Error receiving user audio: ${userId}`);
      }
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
    if (this.isCleaningUp) return;
    this.isCleaningUp = true;

    if (this.speakingStartListener) {
      this.connection.receiver.speaking.off('start', this.speakingStartListener);
      this.speakingStartListener = undefined;
    }

    this.connection.off('stateChange', this.handleConnectionStateChange);
    if (this.agentDisconnectListener) {
      this.client.off('disconnect', this.agentDisconnectListener);
      this.agentDisconnectListener = undefined;
    }

    for (const userId of Array.from(this.speakingUsers.keys())) {
      this.removeUserStream(userId);
    }
    this.client.disconnect();
  }

  /**
   * Removes the stored stream for the user and destroys the underlying
   * `AudioReceiveStream`.
   */
  private removeUserStream(userId: string): void {
    const stream = this.speakingUsers.get(userId);
    if (!stream) return;

    this.speakingUsers.delete(userId);
    const shouldSwitchSpeaker = this.activeSpeakerId === userId;
    if (shouldSwitchSpeaker) {
      this.activeSpeakerId = null;
    }

    if (!stream.destroyed) {
      stream.destroy();
    }

    if (shouldSwitchSpeaker) {
      this.subscribeNextSpeakingUser();
    }
  }

  /**
   * When the active speaker stops, hand off the single upstream ElevenLabs
   * session to another member who is currently speaking.
   */
  private subscribeNextSpeakingUser(): void {
    if (this.isCleaningUp || this.activeSpeakerId) return;

    for (const userId of this.connection.receiver.speaking.users.keys()) {
      if (this.speakingUsers.has(userId)) continue;

      this.handleUserSpeaking(userId);
      break;
    }
  }

  private isPrematureCloseError(error: unknown): boolean {
    return error instanceof Error && (error as CodedError).code === 'ERR_STREAM_PREMATURE_CLOSE';
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
        await new Promise(resolve => setTimeout(resolve, delayMs));
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
