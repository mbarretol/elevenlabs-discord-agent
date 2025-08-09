import { AudioPlayer, createAudioResource, StreamType } from '@discordjs/voice';
import WebSocket from 'ws';
import { logger } from '../../config/logger.js';
import { TAVILY_CONFIG, ELEVENLABS_CONFIG } from '../../config/config.js';
import type {
  AgentResponseEvent,
  AudioEvent,
  ClientToolCallEvent,
  UserTranscriptEvent,
} from './types/websocket.js';
import { TextChannel } from 'discord.js';
import { base64MonoPcmToStereo } from '../../utils/audioUtils.js';
import { PassThrough } from 'stream';
import { TavilyClient } from 'tavily';
import { handleToolCall } from './tools/toolHandlers.js';

/**
 * Manages WebSocket connection and interaction with ElevenLabs Conversational AI.
 * Handles audio streaming, event processing, and various AI interactions.
 * Optimized for low latency using a native Node.js stream for audio conversion.
 */
export class ElevenLabsConversationalAI {
  private url: string;
  private socket: WebSocket | null = null;
  private pcmStream: PassThrough | null = null;
  private tavily: TavilyClient;
  constructor(
    private audioPlayer: AudioPlayer,
    private textChannel: TextChannel
  ) {
    this.url = `${ELEVENLABS_CONFIG.WS_BASE_URL}?agent_id=${ELEVENLABS_CONFIG.AGENT_ID}`;
    this.tavily = new TavilyClient({
      apiKey: TAVILY_CONFIG.TAVILY_KEY,
    });
  }

  /**
   * Establishes a WebSocket connection to the ElevenLabs Conversational AI.
   * @returns A promise that resolves when the connection is open, or rejects on error.
   */
  public async connect(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      logger.info('Establishing connection to ElevenLabs Conversational WebSocket...');
      this.socket = new WebSocket(this.url, { perMessageDeflate: false });

      this.socket.on('open', () => {
        logger.info('Successfully connected to ElevenLabs Conversational WebSocket.');
        this.bindAudioPlayerEvents();
        resolve();
      });

      this.socket.on('error', error => {
        logger.error(error, 'WebSocket encountered an error');
        this.audioPlayer.stop();
        reject(new Error(`Error during WebSocket connection: ${error.message}`));
      });

      this.socket.on('close', (code: number, reason: Buffer) => {
        logger.info(`ElevenLabs WebSocket closed with code ${code}. Reason: ${reason.toString()}`);
        this.cleanup();
      });

      this.socket.on('message', message => this.handleEvent(message));
    });
  }

  /**
   * Cleans up WebSocket resources by closing the connection and removing all listeners.
   */
  private cleanup(): void {
    logger.info('Cleaning up ElevenLabs resources...');
    try {
      if (this.socket) {
        try {
          if (
            this.socket.readyState === WebSocket.OPEN ||
            this.socket.readyState === WebSocket.CONNECTING
          ) {
            this.socket.close();
          }
        } catch {}
        this.socket.removeAllListeners();
        this.socket = null;
      }
      if (this.pcmStream) {
        try {
          this.pcmStream.end();
          this.pcmStream.destroy();
        } catch {}
        this.pcmStream = null;
      }
    } catch {}
    logger.info('Cleanup finished.');
  }

  /**
   * Disconnects from the ElevenLabs WebSocket and cleans up resources.
   */
  public disconnect(): void {
    logger.info('Disconnecting from ElevenLabs...');
    this.cleanup();
  }

  private bindAudioPlayerEvents(): void {
    this.audioPlayer.removeAllListeners();
    this.audioPlayer.on('error', error => {
      logger.error(error, 'AudioPlayer error encountered, ending current PCM stream');
      if (this.pcmStream) {
        try {
          this.pcmStream.end();
          this.pcmStream.destroy();
        } catch {}
        this.pcmStream = null;
      }
    });
  }

  /**
   * Appends a new audio chunk to the input stream for the ElevenLabs AI.
   * @param buffer - PCM 16 kHz mono audio buffer to append; converted to base64 for transport.
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
   * Processes incoming AI audio events. It ensures the audio pipeline is running
   * and then writes the audio chunk to it for playback.
   * @param message - The AudioEvent from the WebSocket.
   */
  private handleAudio(message: AudioEvent): void {
    try {
      const b64 = message.audio_event?.audio_base_64;
      if (!b64) return;

      const stereoBuf = base64MonoPcmToStereo(b64);
      if (!stereoBuf.byteLength) return;

      if (!this.pcmStream || this.pcmStream.destroyed) {
        if (this.pcmStream) {
          try {
            this.pcmStream.end();
            this.pcmStream.destroy();
          } catch {}
        }
        this.pcmStream = new PassThrough({ highWaterMark: 4096 });
        this.pcmStream.write(stereoBuf);

        const resource = createAudioResource(this.pcmStream, {
          inputType: StreamType.Raw,
        });

        this.audioPlayer.play(resource);
      } else {
        this.pcmStream.write(stereoBuf);
      }
    } catch (error) {
      logger.error(error, 'Error while streaming ElevenLabs audio chunk');
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

    try {
      await handleToolCall(
        tool,
        parameters,
        tool_call_id,
        {
          textChannel: this.textChannel,
          tavily: this.tavily,
          disconnect: () => this.disconnect(),
        },
        (id, output, isError = false) => this.sendToolResponse(id, output, isError)
      );
    } catch (error) {
      const errorMessage = `An unexpected error occurred while executing tool '${tool}'.`;
      logger.error(error, `Error handling tool call '${tool}'`);
      this.sendToolResponse(tool_call_id, errorMessage, true);
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
