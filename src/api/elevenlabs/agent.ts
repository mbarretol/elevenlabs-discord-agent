import { AudioPlayer, createAudioResource, StreamType } from '@discordjs/voice';
import WebSocket from 'ws';
import { EventEmitter } from 'events';
import { logger } from '../../config/logger.js';
import { ELEVENLABS_CONFIG, shouldLogConversationText } from '../../config/config.js';
import type {
  AgentResponseEvent,
  AudioEvent,
  ClientToolCallEvent,
  UserTranscriptEvent,
} from './types/websocket.js';
import { monoPcm48kToStereo } from '../../utils/audioUtils.js';
import { PassThrough } from 'stream';

/**
 * Orchestrates the ElevenLabs Agent, maintains the WebSocket session,
 * and streams audio in and out of Discord.
 */
export class Agent extends EventEmitter {
  private socket: WebSocket | null = null;
  private pcmStream: PassThrough | null = null;
  private readonly audioPlayer: AudioPlayer;
  private readonly audioPlayerErrorListener = (error: Error) => {
    logger.error(error, 'AudioPlayer error encountered, ending current PCM stream');
    this.disposePcmStream();
  };
  private readonly socketCloseListener = (code: number, reason: Buffer) =>
    this.handleSocketClose(code, reason);
  private readonly socketMessageListener = (message: WebSocket.RawData) => {
    void this.handleEvent(message);
  };

  constructor(audioPlayer: AudioPlayer) {
    super();
    this.audioPlayer = audioPlayer;
  }

  /**
   * Establishes a WebSocket connection to the ElevenLabs Agent.
   * @returns A promise that resolves when the connection is open, or rejects on error.
   */
  public async connect(): Promise<void> {
    if (this.socket?.readyState === WebSocket.OPEN) {
      logger.debug('Tried to connect while socket already open, reusing existing connection.');
      return;
    }

    await new Promise<void>((resolve, reject) => {
      logger.info('Connecting to ElevenLabs Agent WebSocket...');
      const socket = new WebSocket(ELEVENLABS_CONFIG.AGENT_WS_URL, { perMessageDeflate: false });
      this.socket = socket;

      const handleOpen = () => {
        logger.info('Connected to ElevenLabs Agent WebSocket.');
        socket.off('error', handleError);
        this.bindAudioPlayerEvents();
        resolve();
      };

      const handleError = (error: Error) => {
        logger.error(error, 'ElevenLabs Agent WebSocket encountered an error');
        socket.off('open', handleOpen);
        this.audioPlayer.stop();
        reject(new Error(`Error during ElevenLabs Agent WebSocket connection: ${error.message}`));
      };

      socket.once('open', handleOpen);
      socket.once('error', handleError);
      socket.on('close', this.socketCloseListener);
      socket.on('message', this.socketMessageListener);
    });
  }

  /**
   * Handles remote WebSocket closure and notifies listeners so the Discord voice
   * session can be torn down as well.
   */
  private handleSocketClose(code: number, reason: Buffer): void {
    logger.info(
      `ElevenLabs Agent WebSocket closed with code ${code}. Reason: ${reason.toString()}`
    );
    this.cleanup();
    this.emit('disconnect');
  }

  /**
   * Cleans up WebSocket and playback resources.
   */
  private cleanup(): void {
    logger.info('Cleaning up ElevenLabs resources...');
    this.closeSocket();
    this.disposePcmStream();
    logger.info('Cleanup finished.');
  }

  /**
   * Disconnects from the ElevenLabs WebSocket and cleans up resources.
   */
  public disconnect(): void {
    logger.info('Disconnecting from ElevenLabs...');
    this.cleanup();
  }

  /**
   * Registers error handling on the Discord audio player to keep the PCM stream healthy.
   */
  private bindAudioPlayerEvents(): void {
    this.audioPlayer.off('error', this.audioPlayerErrorListener);
    this.audioPlayer.on('error', this.audioPlayerErrorListener);
  }

  /**
   * Appends a new audio chunk to the input stream for the ElevenLabs Agent.
   * @param buffer - PCM 16 kHz mono audio buffer to append, converted to base64 for transport.
   */
  public appendInputAudio(buffer: Buffer): void {
    if (buffer.byteLength === 0 || this.socket?.readyState !== WebSocket.OPEN) return;

    const base64Audio = {
      user_audio_chunk: buffer.toString('base64'),
    };
    this.socket.send(JSON.stringify(base64Audio));
  }

  /**
   * Handles an interruption event from the ElevenLabs AI, stopping current audio playback.
   */
  private handleInterruption(): void {
    logger.info('Conversation interrupted. Stopping audio playback.');
    this.audioPlayer.stop();
  }

  /**
   * Processes incoming audio events. It ensures the audio pipeline is running
   * and then writes the audio chunk to it for playback.
   * @param message - The AudioEvent from the WebSocket.
   */
  private handleAudio(message: AudioEvent): void {
    try {
      const b64 = message.audio_event?.audio_base_64;
      if (!b64) return;

      const stereoBuf = monoPcm48kToStereo(b64);
      if (!stereoBuf.byteLength) return;

      const { stream, isNew } = this.getOrCreatePcmStream();
      stream.write(stereoBuf);

      if (isNew) {
        const resource = createAudioResource(stream, {
          inputType: StreamType.Raw,
        });

        this.audioPlayer.play(resource);
      }
    } catch (error) {
      logger.error(error, 'Error while streaming ElevenLabs audio chunk');
    }
  }

  /**
   * Provides a writable PCM stream for audio playback, replacing a destroyed stream if needed.
   * @returns The active stream and a flag indicating whether it was newly created.
   */
  private getOrCreatePcmStream(): { stream: PassThrough; isNew: boolean } {
    if (this.pcmStream && !this.pcmStream.destroyed) {
      return { stream: this.pcmStream, isNew: false };
    }

    this.pcmStream = new PassThrough({ highWaterMark: 4096 });
    return { stream: this.pcmStream, isNew: true };
  }

  /**
   * Closes the WebSocket connection and removes Agent-owned listeners.
   */
  private closeSocket(): void {
    if (!this.socket) return;

    const socket = this.socket;
    this.socket = null;
    socket.off('close', this.socketCloseListener);
    socket.off('message', this.socketMessageListener);

    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
      socket.close();
    }
  }

  /**
   * Tears down the PCM stream to release resources and stop playback.
   */
  private disposePcmStream(): void {
    if (!this.pcmStream) return;

    this.pcmStream.destroy();
    this.pcmStream = null;
  }

  /**
   * Handles incoming WebSocket messages, parsing them and directing to appropriate handlers.
   * @param message - The raw WebSocket message data.
   */
  private async handleEvent(message: WebSocket.RawData): Promise<void> {
    let event;
    try {
      event = JSON.parse(message.toString());
      if (!event || typeof event.type !== 'string') {
        logger.warn(`Received invalid WebSocket message: ${message.toString()}`);
        return;
      }

      switch (event.type) {
        case 'agent_response':
          this.handleAgentResponse(event as AgentResponseEvent);
          break;
        case 'user_transcript':
          this.handleUserTranscript(event as UserTranscriptEvent);
          break;
        case 'audio':
          this.handleAudio(event as AudioEvent);
          break;
        case 'interruption':
          this.handleInterruption();
          break;
        case 'client_tool_call':
          this.handleClientToolCall(event as ClientToolCallEvent);
          break;
        default:
          logger.debug(`Received unhandled WebSocket event type: ${event.type}`);
      }
    } catch (error) {
      logger.error(error, 'Error parsing or handling WebSocket message');
      if (!event) {
        logger.error(`Raw message: ${message.toString()}`);
      }
    }
  }

  private handleClientToolCall(event: ClientToolCallEvent): void {
    const toolCall = event.client_tool_call;
    if (!toolCall) {
      logger.warn("Received client_tool_call event with no 'client_tool_call' details.");
      return;
    }

    const { tool_name: tool, tool_call_id } = toolCall;

    if (!tool || !tool_call_id) {
      logger.warn("Received client_tool_call event without 'tool_name' or 'tool_call_id'.");
      return;
    }

    logger.info(`Handling client tool call: ${tool} (ID: ${tool_call_id})`);
    const message = `Error: Unsupported tool '${tool}'.`;
    logger.warn(message);
    this.sendToolResponse(tool_call_id, message, true);
  }

  /**
   * Sends the result of a tool execution back to the ElevenLabs agent,
   * conforming to the documented `client_tool_result` event structure.
   * @param toolCallId - The unique ID for the tool call.
   * @param output - The string output from the tool (the result or an error message).
   * @param isError - A boolean indicating if the output represents an error.
   */
  private sendToolResponse(toolCallId: string, output: string, isError: boolean = false): void {
    if (this.socket?.readyState !== WebSocket.OPEN) {
      logger.warn('Cannot send tool response, WebSocket is not open.');
      return;
    }

    const response = {
      type: 'client_tool_result',
      tool_call_id: toolCallId,
      result: output,
      is_error: isError,
    };

    this.socket.send(JSON.stringify(response));
    logger.info(`Sent tool response for ${toolCallId} (isError: ${isError}).`);
  }

  private handleAgentResponse(event: AgentResponseEvent): void {
    this.logConversationText(
      event.agent_response_event?.agent_response,
      'Agent response received.',
      text => `Agent Response: ${text}`
    );
  }

  private handleUserTranscript(event: UserTranscriptEvent): void {
    this.logConversationText(
      event.user_transcription_event?.user_transcript,
      'User transcript received.',
      text => `User Transcript: "${text}"`
    );
  }

  private logConversationText(
    text: unknown,
    privateMessage: string,
    formatRawMessage: (text: string) => string
  ): void {
    if (typeof text !== 'string' || !text.trim()) return;

    if (shouldLogConversationText()) {
      logger.info(formatRawMessage(text));
    } else {
      logger.info(privateMessage);
    }
  }
}
