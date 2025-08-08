import { getVoiceConnection } from '@discordjs/voice';
import { TextChannel } from 'discord.js';
import { fal } from '@fal-ai/client';
import { TavilyClient } from 'tavily';
import { Embeds } from '../../../utils/embedHelper.js';
import { logger } from '../../../config/logger.js';
import { TAVILY_CONFIG } from '../../../config/config.js';

export interface ToolHandlerDeps {
  textChannel: TextChannel;
  tavily: TavilyClient;
  disconnect: () => void;
}

type SendToolResponse = (toolCallId: string, output: string, isError?: boolean) => void;

async function performWebSearch(query: string, deps: ToolHandlerDeps): Promise<string> {
  logger.info(`Performing web search for: "${query}"`);
  try {
    const response = await deps.tavily.search({
      query,
      max_results: TAVILY_CONFIG.MAX_RESULTS,
      include_answer: TAVILY_CONFIG.INCLUDE_ANSWER,
      include_images: true,
    });

    if (response.answer) {
      const embed = Embeds.info('🔎 Search Results', response.answer);
      if (response.images && response.images.length > 0) {
        embed.setImage(response.images[0]);
      }
      await deps.textChannel.send({ embeds: [embed] });
      return response.answer;
    }

    const summarizedResults = response.results
      .map(result => `Source: ${result.title}\nContent: ${result.content}`)
      .join('\n\n');
    const embed = Embeds.info(
      '🔎 Search Results',
      `Here's what I found about "${query}":\n${summarizedResults}`
    );
    if (response.images && response.images.length > 0) {
      embed.setImage(response.images[0]);
    }
    await deps.textChannel.send({ embeds: [embed] });
    return `Here's what I found about "${query}":\n${summarizedResults}`;
  } catch (error) {
    logger.error(error, 'Error during Tavily web search');
    return 'An error occurred while searching the web. Please try again.';
  }
}

async function leaveChannel(deps: ToolHandlerDeps): Promise<void> {
  logger.info('Received request to leave voice channel.');
  const connection = getVoiceConnection(deps.textChannel.guildId);
  if (connection) {
    logger.info(`Destroying voice connection for guild ${deps.textChannel.guildId}.`);
    connection.destroy();
  } else {
    logger.warn('Leave channel requested, but no active voice connection found.');
  }

  deps.disconnect();

  try {
    if (deps.textChannel.guild.members.me?.permissionsIn(deps.textChannel).has('SendMessages')) {
      await deps.textChannel.send({
        embeds: [Embeds.success('Left Channel', 'Successfully left the voice channel.')],
      });
    } else {
      logger.warn(
        `Cannot send 'Left Channel' confirmation, missing permissions in ${deps.textChannel.id}`
      );
    }
  } catch (sendError) {
    logger.error(sendError, "Error sending 'Left Channel' confirmation message");
  }
}

async function generateAndSendImage(prompt: string, deps: ToolHandlerDeps): Promise<string> {
  logger.info(`Generating image with prompt: "${prompt}"`);
  let generatingMessage;
  try {
    generatingMessage = await deps.textChannel.send({
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
        logger.debug({ update }, 'Fal image generation queue update');
      },
    });

    const imageUrl = result?.images?.[0]?.url || result?.data?.images?.[0]?.url;

    if (imageUrl) {
      logger.info(`Image generated successfully: ${imageUrl}`);
      const successEmbed = Embeds.success('🎨 Generated Image', prompt).setImage(imageUrl);
      if (generatingMessage) {
        await generatingMessage.edit({ embeds: [successEmbed] });
      } else {
        await deps.textChannel.send({ embeds: [successEmbed] });
      }
      return `Successfully generated and posted an image for the prompt: "${prompt}"`;
    } else {
      logger.error({ result }, 'Image generation failed or no URL found');
      const errorEmbed = Embeds.error(
        'Generation Failed',
        'Image generation did not return a valid image.'
      );
      if (generatingMessage) await generatingMessage.edit({ embeds: [errorEmbed] });
      else await deps.textChannel.send({ embeds: [errorEmbed] });
      return 'I tried to generate the image, but the operation failed to produce a result.';
    }
  } catch (error) {
    logger.error(error, 'Error generating image via fal.subscribe');
    const errorEmbed = Embeds.error(
      'Image Generation Error',
      'A technical error occurred during image generation.'
    );
    try {
      if (generatingMessage) await generatingMessage.edit({ embeds: [errorEmbed] });
      else await deps.textChannel.send({ embeds: [errorEmbed] });
    } catch (sendError) {
      logger.error(sendError, 'Failed to send image generation error message');
    }
    return 'I encountered a technical error while trying to generate the image.';
  }
}

export async function handleToolCall(
  tool: string,
  parameters: Record<string, any> | undefined,
  toolCallId: string,
  deps: ToolHandlerDeps,
  sendToolResponse: SendToolResponse
): Promise<void> {
  switch (tool) {
    case 'generate_image': {
      const imageDescription = parameters?.image_description;
      if (imageDescription && typeof imageDescription === 'string') {
        const result = await generateAndSendImage(imageDescription, deps);
        sendToolResponse(toolCallId, result, false);
      } else {
        const errorMessage = 'Error: Missing image_description parameter.';
        logger.warn(`'generate_image' called without valid 'image_description'.`);
        sendToolResponse(toolCallId, errorMessage, true);
      }
      break;
    }
    case 'leave_channel':
      await leaveChannel(deps);
      return;
    case 'web_search': {
      const query = parameters?.query;
      if (query && typeof query === 'string') {
        const result = await performWebSearch(query, deps);
        sendToolResponse(toolCallId, result, false);
      } else {
        const errorMessage = 'Error: Missing query parameter.';
        logger.warn(`'web_search' called without valid 'query'.`);
        sendToolResponse(toolCallId, errorMessage, true);
      }
      break;
    }
    default: {
      const errorMessage = `Error: Unknown tool '${tool}'.`;
      logger.warn(`Received unknown client tool call: ${tool}`);
      sendToolResponse(toolCallId, errorMessage, true);
      break;
    }
  }
}
