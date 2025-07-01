import {
  AudioPlayer,
  createAudioResource,
  StreamType,
  getVoiceConnection,
  AudioPlayerStatus,
} from '@discordjs/voice';
import WebSocket from 'ws';
import { ELEVENLABS_CONFIG } from '../../config/config.js';
import { logger } from '../../config/index.js';
import type {
  AgentResponseEvent,
  AudioEvent,
  ClientToolCallEvent,
  UserTranscriptEvent,
} from './types.js';
import { fal } from '@fal-ai/client';
import { TextChannel } from 'discord.js';
import { Embeds } from '../../utils/index.js';
import { PassThrough } from 'stream';
import { base64MonoPcmToStereo } from '../../utils/index.js';

/**
 * Manages WebSocket connection and interaction with ElevenLabs Conversational AI.
 * Handles audio streaming, event processing, and various AI interactions.
 * Optimized for low latency using a native Node.js stream for audio conversion.
 */
export class ElevenLabsConversationalAI {
  private url: string;
  private socket: WebSocket | null = null;
  private pcmStream: PassThrough | null = null;
  constructor(
    private audioPlayer: AudioPlayer,
    private textChannel: TextChannel
  ) {
    this.url = `${ELEVENLABS_CONFIG.WS_BASE_URL}?agent_id=${ELEVENLABS_CONFIG.AGENT_ID}`;
  }

  /**
   * Establishes a WebSocket connection to the ElevenLabs Conversational AI.
   * @returns A promise that resolves when the connection is open, or rejects on error.
   */
  public async connect(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      logger.info('Establishing connection to ElevenLabs Conversational WebSocket...');
      this.socket = new WebSocket(this.url);

      this.socket.on('open', () => {
        logger.info('Successfully connected to ElevenLabs Conversational WebSocket.');
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

    if (this.socket) {
      if (
        this.socket.readyState === WebSocket.OPEN ||
        this.socket.readyState === WebSocket.CONNECTING
      ) {
        this.socket.close();
      }
      this.socket.removeAllListeners();
      this.socket = null;
    }
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
   * Appends a new audio chunk to the input stream for the ElevenLabs AI.
   * @param buffer - The audio buffer to append, in base64 format.
   */
  public appendInputAudio(buffer: Buffer): void {
    if (buffer.byteLength === 0) return;
    if (this.socket?.readyState !== WebSocket.OPEN) return;

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
    this.pcmStream?.end();
    this.pcmStream = null;
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
        this.pcmStream = new PassThrough();
        this.pcmStream.write(stereoBuf);

        const resource = createAudioResource(this.pcmStream, {
          inputType: StreamType.Raw,
        });

        this.audioPlayer.play(resource);
      } else {
        this.pcmStream.write(stereoBuf);
      }
    } catch (err) {
      logger.error('Error while streaming ElevenLabs audio chunk:', err);
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
        logger.warn('Received invalid WebSocket message:', message.toString());
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
      logger.error('Error parsing or handling WebSocket message:', error);
      if (!event) {
        logger.error('Raw message:', message.toString());
      }
    }
  }

  /**
   * Handles `client_tool_call` events, executing the requested tool (e.g., generating an image or leaving a channel).
   * @param event - The ClientToolCallEvent containing details of the tool call.
   */
  private async handleClientToolCall(event: ClientToolCallEvent): Promise<void> {
    const toolCall = event.client_tool_call;
    if (!toolCall) {
      logger.warn("Received client_tool_call event with no 'client_tool_call' details.");
      return;
    }
    const tool = toolCall.tool_name;
    const parameters = toolCall.parameters || {};

    if (!tool) {
      logger.warn("Received client_tool_call event without 'tool_name'.");
      return;
    }

    logger.info(`Handling client tool call: ${tool}`);

    try {
      switch (tool) {
        case 'generate_image':
          const imageDescription = parameters?.image_description;
          if (imageDescription && typeof imageDescription === 'string') {
            await this.generateAndSendImage(imageDescription);
          } else {
            logger.warn(`'generate_image' called without valid 'image_description'.`);
            await this.textChannel
              .send({ embeds: [Embeds.error('Missing Info', 'Image description missing.')] })
              .catch(e => logger.error("Failed to send 'Missing Info' embed:", e));
          }
          break;
        case 'leave_channel':
          await this.leaveChannel();
          break;
        default:
          logger.warn(`Received unknown client tool call: ${tool}`);
      }
    } catch (error) {
      logger.error(`Error handling tool call '${tool}':`, error);
      try {
        await this.textChannel.send({
          embeds: [Embeds.error('Tool Error', `Error using the ${tool} tool.`)],
        });
      } catch (sendError) {
        logger.error(`Failed to send tool error message for ${tool}:`, sendError);
      }
    }
  }

  /**
   * Handles the request to make the bot leave the current voice channel.
   */
  private async leaveChannel(): Promise<void> {
    logger.info('Received request to leave voice channel.');
    const connection = getVoiceConnection(this.textChannel.guildId);
    if (connection) {
      logger.info(`Destroying voice connection for guild ${this.textChannel.guildId}.`);
      connection.destroy();
    } else {
      logger.warn('Leave channel requested, but no active voice connection found.');
    }

    this.disconnect();

    try {
      if (this.textChannel.guild.members.me?.permissionsIn(this.textChannel).has('SendMessages')) {
        await this.textChannel.send({
          embeds: [Embeds.success('Left Channel', 'Successfully left the voice channel.')],
        });
      } else {
        logger.warn(
          `Cannot send 'Left Channel' confirmation, missing permissions in ${this.textChannel.id}`
        );
      }
    } catch (sendError) {
      logger.error("Error sending 'Left Channel' confirmation message:", sendError);
    }
  }

  /**
   * Generates an image using the fal.ai service and sends it to the text channel.
   * @param prompt - The prompt to use for image generation.
   */
  private async generateAndSendImage(prompt: string): Promise<void> {
    logger.info(`Generating image with prompt: "${prompt}"`);
    let generatingMessage;

    try {
      generatingMessage = await this.textChannel.send({
        embeds: [Embeds.info('🎨 Generating Image...', `"${prompt}"\nPlease wait...`)],
      });

      const result: any = await fal.subscribe('fal-ai/flux/dev', {
        input: {
          prompt: prompt,
          image_size: 'landscape_16_9',
          num_images: 1,
        },
        logs: true,
        onQueueUpdate(update) {
          logger.debug('Fal image generation queue update:', update);
        },
      });

      const imageUrl = result?.images?.[0]?.url || result?.data?.images?.[0]?.url;

      if (imageUrl) {
        logger.info(`Image generated successfully: ${imageUrl}`);
        if (generatingMessage) {
          await generatingMessage.edit({
            embeds: [Embeds.success('🎨 Generated Image', prompt).setImage(imageUrl)],
          });
        } else {
          await this.textChannel.send({
            embeds: [Embeds.success('🎨 Generated Image', prompt).setImage(imageUrl)],
          });
        }
      } else {
        logger.error('Image generation failed or no URL found:', result);
        const errorEmbed = Embeds.error(
          'Generation Failed',
          'Image generation did not return a valid image.'
        );
        if (generatingMessage) await generatingMessage.edit({ embeds: [errorEmbed] });
        else await this.textChannel.send({ embeds: [errorEmbed] });
      }
    } catch (error) {
      logger.error('Error generating image via fal.subscribe:', error);
      const errorEmbed = Embeds.error('Image Generation Error', 'Error during image generation.');
      try {
        if (generatingMessage) await generatingMessage.edit({ embeds: [errorEmbed] });
        else await this.textChannel.send({ embeds: [errorEmbed] });
      } catch (sendError) {
        logger.error('Failed to send image generation error message:', sendError);
      }
    }
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
