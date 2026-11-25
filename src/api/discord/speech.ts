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
const FRAME_MS = 20;
const STREAM_INACTIVITY_MS = 300;
const RECONNECT_TIMEOUT_MS = 5_000;

// Discord sends nothing while a user is silent, but the agent detects the end of
// a turn from the silence it hears, like from an always-on microphone. The bot
// therefore streams silence in real time whenever no voice is coming in.
const silence = (ms: number) => Buffer.alloc((SAMPLE_RATE * BYTES_PER_SAMPLE * ms) / 1000);
const SILENCE_FRAME = silence(FRAME_MS);
// How long without voice packets before the user counts as silent. Leaves room
// for network jitter, which would otherwise insert silence mid-sentence.
const SILENCE_AFTER_MS = 60;
// Silence sent at once when the user stops, ahead of real time. It gives the
// turn detection a head start; the real-time silence that follows is what
// guarantees an answer. Lower it if the agent cuts users off during pauses.
const HEAD_START_SILENCE = silence(300);
// Discord clients end each transmission with these Opus frames. They are
// dropped so the end of speech is detected at the last voice packet.
const OPUS_SILENCE_FRAME = Buffer.from([0xf8, 0xff, 0xfe]);

/** Returns the name the agent should know a Discord user by. */
export type SpeakerNameResolver = (userId: string) => Promise<string>;

/**
 * Streams one Discord speaker at a time to the ElevenLabs agent, tells it who
 * is speaking, and ties the lifetime of the agent session to the voice connection.
 */
export class SpeechHandler {
  private readonly agent: Agent;
  private readonly connection: VoiceConnection;
  private readonly getSpeakerName: SpeakerNameResolver;
  private readonly decoder = new opus.OpusEncoder(SAMPLE_RATE, 1);
  private speaker: { userId: string; stream: AudioReceiveStream } | null = null;
  private lastSpeakerId: string | null = null;
  private silenceTimer: NodeJS.Timeout | undefined;
  private lastVoiceAt = 0;
  private userSilent = true;

  constructor(agent: Agent, connection: VoiceConnection, getSpeakerName: SpeakerNameResolver) {
    this.agent = agent;
    this.connection = connection;
    this.getSpeakerName = getSpeakerName;
  }

  /**
   * Connects to ElevenLabs, then starts listening to the voice connection and
   * streaming audio. Speech before that would be lost anyway.
   */
  async initialize(): Promise<void> {
    this.connection.on(VoiceConnectionStatus.Disconnected, () => void this.handleDisconnect());
    this.connection.once(VoiceConnectionStatus.Destroyed, () => this.handleDestroy());

    await this.agent.connect(() => {
      logger.warn('ElevenLabs agent disconnected. Destroying voice connection.');
      this.connection.destroy();
    });
    this.connection.receiver.speaking.on('start', userId => this.handleSpeakingStart(userId));
    this.silenceTimer = setInterval(() => this.sendSilence(), FRAME_MS);
  }

  /**
   * Subscribes to the user's audio unless someone is already being streamed,
   * and names them to the agent when they take over from someone else.
   * The stream ends itself after a short period without voice packets.
   */
  private handleSpeakingStart(userId: string): void {
    if (this.speaker) return;

    if (userId !== this.lastSpeakerId) {
      this.lastSpeakerId = userId;
      void this.announceSpeaker(userId);
    }

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

  private async announceSpeaker(userId: string): Promise<void> {
    try {
      this.agent.sendContextualUpdate(`${await this.getSpeakerName(userId)} is now speaking.`);
    } catch (error) {
      logger.warn(error, `Could not name speaker ${userId} to the agent`);
    }
  }

  private forwardAudio(packet: Buffer): void {
    if (packet.equals(OPUS_SILENCE_FRAME)) return;

    this.lastVoiceAt = Date.now();
    this.userSilent = false;
    try {
      this.agent.appendInputAudio(this.decoder.decode(packet));
    } catch (error) {
      logger.error(error, 'Error decoding user audio');
    }
  }

  /**
   * Runs every frame. Sends a frame of silence while no voice is coming in, and
   * marks the end of the user's speech when the voice stops.
   */
  private sendSilence(): void {
    if (Date.now() - this.lastVoiceAt < SILENCE_AFTER_MS) return;

    if (this.userSilent) {
      this.agent.appendInputAudio(SILENCE_FRAME);
      return;
    }
    this.userSilent = true;
    this.agent.markUserSpeechEnd(this.lastVoiceAt);
    this.agent.appendInputAudio(HEAD_START_SILENCE);
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
    clearInterval(this.silenceTimer);
    this.speaker?.stream.destroy();
    this.agent.disconnect();
  }
}
