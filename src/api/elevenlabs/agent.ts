import {
  type AudioPlayer,
  type AudioResource,
  createAudioResource,
  StreamType,
} from '@discordjs/voice';
import { PassThrough } from 'stream';
import WebSocket from 'ws';
import { logger } from '../../config/logger.js';
import { monoPcm48kToStereo } from '../../utils/audioUtils.js';
import type { ClientEvent, ClientToolCallEvent, ServerEvent } from './types/websocket.js';

/** A tool the agent can call. Its result, or the message of the error it throws, is sent back. */
export type ClientTool = (parameters: Record<string, unknown>) => Promise<string>;

export interface AgentOptions {
  url: string;
  audioPlayer: AudioPlayer;
  tools?: Record<string, ClientTool>;
}

/**
 * Maintains the WebSocket session with an ElevenLabs agent and plays the
 * agent's audio through a Discord audio player.
 */
export class Agent {
  private readonly url: string;
  private readonly audioPlayer: AudioPlayer;
  private readonly tools: Record<string, ClientTool>;
  private socket: WebSocket | null = null;
  private playback: { pcm: PassThrough; resource: AudioResource } | null = null;

  constructor({ url, audioPlayer, tools = {} }: AgentOptions) {
    this.url = url;
    this.audioPlayer = audioPlayer;
    this.tools = tools;
    this.audioPlayer.on('error', error => logger.error(error, 'AudioPlayer error'));
  }

  /**
   * Opens the session. Rejects if the connection cannot be established.
   * @param onClose - Called when the socket closes for any reason other than `disconnect()`.
   */
  public async connect(onClose: () => void): Promise<void> {
    logger.info('Connecting to ElevenLabs Agent WebSocket...');
    const socket = new WebSocket(this.url, { perMessageDeflate: false });
    this.socket = socket;

    // ws always emits 'close' after 'error', so the close handler does the teardown.
    socket.on('error', error => logger.error(error, 'ElevenLabs Agent WebSocket error'));
    socket.on('message', data => void this.handleMessage(data));
    socket.on('close', (code, reason) => {
      logger.info(`ElevenLabs Agent WebSocket closed with code ${code}. Reason: ${reason}`);
      if (this.socket !== socket) return;

      this.disconnect();
      onClose();
    });

    await new Promise<void>((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', reject);
    });
    logger.info('Connected to ElevenLabs Agent WebSocket.');
  }

  /**
   * Closes the session and stops playback.
   */
  public disconnect(): void {
    const socket = this.socket;
    this.socket = null;
    socket?.close();

    this.audioPlayer.stop(true);
    this.playback = null;
  }

  /**
   * Sends a chunk of user audio to the agent.
   * @param buffer - 16 kHz 16-bit mono PCM.
   */
  public appendInputAudio(buffer: Buffer): void {
    this.send({ user_audio_chunk: buffer.toString('base64') });
  }

  private send(event: ClientEvent): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(event));
    }
  }

  private async handleMessage(data: WebSocket.RawData): Promise<void> {
    try {
      const event = JSON.parse(data.toString()) as ServerEvent;

      switch (event.type) {
        case 'audio':
          this.getPcmStream().write(monoPcm48kToStereo(event.audio_event.audio_base_64));
          break;
        case 'interruption':
          logger.info('Conversation interrupted. Stopping audio playback.');
          this.audioPlayer.stop();
          break;
        case 'agent_response':
          logger.info(`Agent Response: ${event.agent_response_event.agent_response}`);
          break;
        case 'user_transcript':
          logger.info(`User Transcript: "${event.user_transcription_event.user_transcript}"`);
          break;
        case 'client_tool_call':
          await this.handleClientToolCall(event.client_tool_call);
          break;
      }
    } catch (error) {
      logger.error(error, 'Error handling ElevenLabs Agent WebSocket message');
    }
  }

  /**
   * Returns the stream feeding the current playback. A new playback is started
   * when there is none, or when the player has begun winding the current one
   * down (after an interruption, an underrun or an error): audio written to
   * that one would be dropped.
   */
  private getPcmStream(): PassThrough {
    const current = this.playback;
    if (
      current &&
      current.resource.silenceRemaining === -1 &&
      !current.resource.playStream.destroyed
    ) {
      return current.pcm;
    }

    const pcm = new PassThrough();
    const resource = createAudioResource(pcm, { inputType: StreamType.Raw });
    this.playback = { pcm, resource };
    this.audioPlayer.play(resource);
    return pcm;
  }

  private async handleClientToolCall({
    tool_name: name,
    tool_call_id,
    parameters = {},
  }: ClientToolCallEvent['client_tool_call']): Promise<void> {
    logger.info(`Handling client tool call: ${name} (ID: ${tool_call_id})`);

    let result: string;
    let isError = false;
    try {
      const tool = this.tools[name];
      if (!tool) throw new Error(`Unsupported tool '${name}'.`);
      result = await tool(parameters);
    } catch (error) {
      logger.warn(error, `Client tool '${name}' failed.`);
      result = `Error: ${error instanceof Error ? error.message : String(error)}`;
      isError = true;
    }

    this.send({ type: 'client_tool_result', tool_call_id, result, is_error: isError });
  }
}
