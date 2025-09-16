import { AudioPlayer, createAudioResource, StreamType } from '@discordjs/voice';
import WebSocket from 'ws';
import { logger } from '../../config/logger.js';
import { ELEVENLABS_CONFIG } from '../../config/config.js';
import type {
  AgentResponseEvent,
  AudioEvent,
  ClientToolCallEvent,
  UserTranscriptEvent,
} from './types/websocket.js';
import { base64MonoPcmToStereo } from '../../utils/audioUtils.js';
import { PassThrough } from 'stream';
import { ToolRegistry } from './tools/toolRegistry.js';

/**
 * Orchestrates the ElevenLabs Agent, maintains the WebSocket session,
 * streams audio in and out of Discord, and dispatches tool calls.
 */
export class Agent {
  private url: string;
  private socket: WebSocket | null = null;
  private pcmStream: PassThrough | null = null;
  constructor(
    private audioPlayer: AudioPlayer,
    private toolRegistry: ToolRegistry
  ) {
    this.url = `${ELEVENLABS_CONFIG.WS_BASE_URL}?agent_id=${ELEVENLABS_CONFIG.AGENT_ID}`;
  }

  /**
   * Establishes a WebSocket connection to the ElevenLabs Agent.
   * @returns A promise that resolves when the connection is open, or rejects on error.
   */
  public async connect(): Promise<void> {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      logger.debug('Tried to connect while socket already open; reusing existing connection.');
      return;
    }

    await new Promise<void>((resolve, reject) => {
      logger.info('Connecting to ElevenLabs Agent WebSocket...');
      this.socket = new WebSocket(this.url, { perMessageDeflate: false });

      const handleOpen = () => {
        logger.info('Connected to ElevenLabs Agent WebSocket.');
        this.socket?.removeListener('error', handleError);
        this.bindAudioPlayerEvents();
        resolve();
      };

      const handleError = (error: Error) => {
        logger.error(error, 'ElevenLabs Agent WebSocket encountered an error');
        this.socket?.removeListener('open', handleOpen);
        this.audioPlayer.stop();
        reject(new Error(`Error during ElevenLabs Agent WebSocket connection: ${error.message}`));
      };

      this.socket?.once('open', handleOpen);
      this.socket?.once('error', handleError);

      this.socket?.on('close', (code: number, reason: Buffer) => {
        logger.info(`ElevenLabs Agent WebSocket closed with code ${code}. Reason: ${reason.toString()}`);
        this.cleanup();
      });

      this.socket?.on('message', message => this.handleEvent(message));
    });
  }

  /**
   * Cleans up WebSocket resources by closing the connection and removing all listeners.
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
    this.audioPlayer.removeAllListeners();
    this.audioPlayer.on('error', error => {
      logger.error(error, 'AudioPlayer error encountered, ending current PCM stream');
      this.disposePcmStream();
    });
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

      const stereoBuf = base64MonoPcmToStereo(b64);
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
   * Closes the WebSocket connection and removes all listeners.
   */
  private closeSocket(): void {
    if (!this.socket) return;

    try {
      if (
        this.socket.readyState === WebSocket.OPEN ||
        this.socket.readyState === WebSocket.CONNECTING
      ) {
        this.socket.close();
      }
    } catch (error) {
      logger.debug(error, 'Error closing WebSocket');
    } finally {
      this.socket.removeAllListeners();
      this.socket = null;
    }
  }

  /**
   * Tears down the PCM stream to release resources and stop playback.
   */
  private disposePcmStream(): void {
    if (!this.pcmStream) return;

    try {
      this.pcmStream.destroy();
    } catch (error) {
      logger.debug(error, 'Error destroying PCM stream');
    } finally {
      this.pcmStream = null;
    }
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
          await this.handleClientToolCall(event as ClientToolCallEvent);
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

  /**
   * Handles `client_tool_call` events by executing the requested tool and replying with a
   * `client_tool_result` event.
   */
  private async handleClientToolCall(event: ClientToolCallEvent): Promise<void> {
    const toolCall = event.client_tool_call;
    if (!toolCall) {
      logger.warn("Received client_tool_call event with no 'client_tool_call' details.");
      return;
    }

    const { tool_name: tool, parameters, tool_call_id } = toolCall;

    if (!tool || !tool_call_id) {
      logger.warn("Received client_tool_call event without 'tool_name' or 'tool_call_id'.");
      return;
    }

    logger.info(`Handling client tool call: ${tool} (ID: ${tool_call_id})`);

    const handler = this.toolRegistry.get(tool);
    if (!handler) {
      const message = `Error: Unsupported tool '${tool}'.`;
      logger.warn(message);
      this.sendToolResponse(tool_call_id, message, true);
      return;
    }

    const respond = (output: string, isError: boolean = false) => {
      this.sendToolResponse(tool_call_id, output, isError);
    };

    try {
      await handler({
        parameters,
        toolCallId: tool_call_id,
        respond,
      });
    } catch (error) {
      logger.error(error, `Tool '${tool}' (${tool_call_id}) threw an error`);
      respond('An error occurred while executing the tool. Please try again later.', true);
    }
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

  /**
   * Handles agent response events, logging the agent's response text.
   * @param event - The AgentResponseEvent containing the agent's response.
   */
  private handleAgentResponse(event: AgentResponseEvent): void {
    const agentResponseText = event.agent_response_event?.agent_response;
    if (agentResponseText && typeof agentResponseText === 'string' && agentResponseText.trim()) {
      logger.info(`Agent Response: ${agentResponseText}`);
    }
  }

  /**
   * Handles user transcript events, logging the user's transcribed text.
   * @param event - The UserTranscriptEvent containing the user's transcript.
   */
  private handleUserTranscript(event: UserTranscriptEvent): void {
    const userTranscriptText = event.user_transcription_event?.user_transcript;
    if (userTranscriptText && typeof userTranscriptText === 'string' && userTranscriptText.trim()) {
      logger.info(`User Transcript: "${userTranscriptText}"`);
    }
  }

}
