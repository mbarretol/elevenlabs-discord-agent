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

/**
 * Streams one Discord speaker's voice packets to the ElevenLabs agent while
 * the voice connection is active.
 */
class SpeechHandler {
  private activeStream: AudioReceiveStream | null = null;
  private activeSpeakerId: string | null = null;
  private isCleaningUp = false;
  private readonly client: Agent;
  private decoder: opus.OpusEncoder;
  private readonly connection: VoiceConnection;
  private readonly speakingStartListener = this.handleUserSpeaking.bind(this);
  private readonly agentDisconnectListener = this.handleAgentDisconnect.bind(this);

  /**
   * @param client - ElevenLabs agent that receives PCM chunks.
   * @param connection - Active Discord voice connection to monitor.
   */
  constructor(client: Agent, connection: VoiceConnection) {
    this.client = client;
    this.decoder = new opus.OpusEncoder(16000, 1);
    this.connection = connection;
  }

  /**
   * Connects to ElevenLabs, then wires up voice connection event listeners so
   * we can subscribe to users as they begin speaking.
   */
  async initialize(): Promise<void> {
    await this.client.connect();

    this.connection.receiver.speaking.on('start', this.speakingStartListener);
    this.connection.on('stateChange', this.handleConnectionStateChange);
    this.client.on('disconnect', this.agentDisconnectListener);
  }

  /**
   * Creates one receive stream for the first speaker during the session.
   * Speaking gaps do not close the stream.
   */
  private handleUserSpeaking(userId: string): void {
    if (this.isCleaningUp || this.activeSpeakerId) return;

    this.activeSpeakerId = userId;
    this.createUserAudioStream(userId);
  }

  private handleAgentDisconnect(): void {
    logger.warn('ElevenLabs agent disconnected. Destroying voice connection.');
    this.connection.destroy();
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

      this.activeStream = opusAudioStream;

      for await (const opusBuffer of opusAudioStream) {
        this.processAudio(opusBuffer);
      }
    } catch (error) {
      if (!this.isCleaningUp) {
        logger.error(error, `Error receiving user audio: ${userId}`);
      }
    } finally {
      this.resetActiveStream(userId);
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

    this.connection.receiver.speaking.off('start', this.speakingStartListener);
    this.connection.off('stateChange', this.handleConnectionStateChange);
    this.client.off('disconnect', this.agentDisconnectListener);

    this.resetActiveStream();
    this.client.disconnect();
  }

  /**
   * Clears the active speaker and destroys the underlying receive stream.
   */
  private resetActiveStream(userId?: string): void {
    if (userId && this.activeSpeakerId !== userId) return;

    const stream = this.activeStream;
    this.activeStream = null;
    this.activeSpeakerId = null;
    if (stream && !stream.destroyed) {
      stream.destroy();
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
