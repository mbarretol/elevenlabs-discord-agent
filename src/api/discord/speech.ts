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

const SPEECH_INACTIVITY_TIMEOUT_MS = 300;
const ELEVENLABS_INPUT_SAMPLE_RATE = 16000;
const PCM_16_BIT_BYTES = 2;
const SPEECH_END_SILENCE_MS = 300;
const SPEECH_END_SILENCE = Buffer.alloc(
  (ELEVENLABS_INPUT_SAMPLE_RATE * PCM_16_BIT_BYTES * SPEECH_END_SILENCE_MS) / 1000
);

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
  private readonly speakingEndListener = this.handleUserStoppedSpeaking.bind(this);
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
    this.connection.receiver.speaking.on('end', this.speakingEndListener);
    this.connection.on('stateChange', this.handleConnectionStateChange);
    this.client.on('disconnect', this.agentDisconnectListener);
  }

  /**
   * Creates an utterance receive stream for the active speaker.
   */
  private handleUserSpeaking(userId: string): void {
    if (this.isCleaningUp) return;
    if (this.activeSpeakerId && this.activeSpeakerId !== userId) return;

    if (this.activeSpeakerId) return;

    this.activeSpeakerId = userId;
    this.createUserAudioStream(userId);
  }

  private handleUserStoppedSpeaking(userId: string): void {
    if (this.isCleaningUp || this.activeSpeakerId !== userId) return;

    this.client.appendInputAudio(SPEECH_END_SILENCE);
  }

  private handleAgentDisconnect(): void {
    logger.warn('ElevenLabs agent disconnected. Destroying voice connection.');
    this.connection.destroy();
  }

  /**
   * Subscribes to a user's Opus stream and forwards decoded audio to ElevenLabs
   * until Discord sees a short period without voice packets.
   */
  private async createUserAudioStream(userId: string): Promise<void> {
    try {
      const opusAudioStream: AudioReceiveStream = this.connection.receiver.subscribe(userId, {
        end: {
          behavior: EndBehaviorType.AfterInactivity,
          duration: SPEECH_INACTIVITY_TIMEOUT_MS,
        },
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
    this.connection.receiver.speaking.off('end', this.speakingEndListener);
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
