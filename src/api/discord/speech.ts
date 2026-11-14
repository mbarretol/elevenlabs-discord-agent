import opus from '@discordjs/opus';
import {
  type AudioReceiveStream,
  EndBehaviorType,
  type VoiceConnection,
  VoiceConnectionStatus,
  entersState,
} from '@discordjs/voice';
import { logger } from '../../config/logger.js';
import type { Agent } from '../elevenlabs/agent.js';

const SAMPLE_RATE = 16_000;
const BYTES_PER_SAMPLE = 2;
const STREAM_INACTIVITY_MS = 300;
const TRAILING_SILENCE_MS = 300;
// Discord sends nothing while a user is silent, so the agent is given explicit
// silence to detect the end of the turn.
const TRAILING_SILENCE = Buffer.alloc(
  (SAMPLE_RATE * BYTES_PER_SAMPLE * TRAILING_SILENCE_MS) / 1000
);
const RECONNECT_TIMEOUT_MS = 5_000;

/**
 * Streams one Discord speaker at a time to the ElevenLabs agent and ties the
 * lifetime of the agent session to the voice connection.
 */
export class SpeechHandler {
  private readonly agent: Agent;
  private readonly connection: VoiceConnection;
  private readonly decoder = new opus.OpusEncoder(SAMPLE_RATE, 1);
  private speaker: { userId: string; stream: AudioReceiveStream } | null = null;

  constructor(agent: Agent, connection: VoiceConnection) {
    this.agent = agent;
    this.connection = connection;
  }

  /**
   * Starts listening to the voice connection, then connects to ElevenLabs.
   */
  async initialize(): Promise<void> {
    const { speaking } = this.connection.receiver;
    speaking.on('start', userId => this.handleSpeakingStart(userId));
    speaking.on('end', userId => this.handleSpeakingEnd(userId));
    this.connection.on(VoiceConnectionStatus.Disconnected, () => void this.handleDisconnect());
    this.connection.once(VoiceConnectionStatus.Destroyed, () => this.handleDestroy());

    await this.agent.connect(() => {
      logger.warn('ElevenLabs agent disconnected. Destroying voice connection.');
      this.connection.destroy();
    });
  }

  /**
   * Subscribes to the user's audio unless someone is already being streamed.
   * The stream ends itself after a short period without voice packets.
   */
  private handleSpeakingStart(userId: string): void {
    if (this.speaker) return;

    const stream = this.connection.receiver.subscribe(userId, {
      end: { behavior: EndBehaviorType.AfterInactivity, duration: STREAM_INACTIVITY_MS },
    });
    this.speaker = { userId, stream };

    stream.on('data', (packet: Buffer) => this.forwardAudio(packet));
    stream.on('error', error => logger.error(error, `Error receiving user audio: ${userId}`));
    stream.once('close', () => {
      this.speaker = null;
    });
  }

  private handleSpeakingEnd(userId: string): void {
    if (this.speaker?.userId === userId) {
      this.agent.appendInputAudio(TRAILING_SILENCE);
    }
  }

  private forwardAudio(packet: Buffer): void {
    try {
      this.agent.appendInputAudio(this.decoder.decode(packet));
    } catch (error) {
      logger.error(error, 'Error decoding user audio');
    }
  }

  /**
   * Discord moves the bot between channels by disconnecting and reconnecting
   * it. Any other disconnect is final.
   */
  private async handleDisconnect(): Promise<void> {
    try {
      await Promise.race([
        entersState(this.connection, VoiceConnectionStatus.Signalling, RECONNECT_TIMEOUT_MS),
        entersState(this.connection, VoiceConnectionStatus.Connecting, RECONNECT_TIMEOUT_MS),
      ]);
    } catch {
      // The connection may have been destroyed while waiting, e.g. by /leave.
      if (this.connection.state.status !== VoiceConnectionStatus.Destroyed) {
        logger.warn('Voice connection lost. Destroying it.');
        this.connection.destroy();
      }
    }
  }

  private handleDestroy(): void {
    logger.info('Voice connection destroyed. Cleaning up.');
    this.speaker?.stream.destroy();
    this.agent.disconnect();
  }
}
