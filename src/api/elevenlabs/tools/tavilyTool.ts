import type { TextChannel } from 'discord.js';
import { tavily } from '@tavily/core';
import { TAVILY_CONFIG } from '../../../config/config.js';
import { Embeds } from '../../../utils/embedHelper.js';
import { logger } from '../../../config/logger.js';
import type { ToolHandler } from '../types/tools.js';

export function createTavilyTool(textChannel: TextChannel): ToolHandler {
  const apiKey = TAVILY_CONFIG.TAVILY_KEY;
  if (!apiKey) {
    throw new Error('Tavily API key is required to initialize the Tavily tool.');
  }

  const client = tavily({
    apiKey,
  });

  return async ({ parameters, respond }) => {
    const query = typeof parameters?.query === 'string' ? parameters.query.trim() : '';
    if (!query) {
      respond('Error: Missing query parameter.', true);
      return;
    }

    try {
      const response = await client.search(query, {
        autoParameters: TAVILY_CONFIG.AUTO_PARAMETERS,
        includeImages: TAVILY_CONFIG.INCLUDE_IMAGES,
        maxResults: TAVILY_CONFIG.MAX_RESULTS,
        includeAnswer: TAVILY_CONFIG.INCLUDE_ANSWER,
        searchDepth: TAVILY_CONFIG.SEARCH_DEPTH,
      });

      const primaryResult = response.results?.find(
        candidate => typeof candidate?.url === 'string' && candidate.url.trim().length > 0
      );
      const answer = typeof response.answer === 'string' ? response.answer.trim() : '';
      if (!answer) {
        respond('No search results found.', false);
        return;
      }

      const embed = Embeds.info('🔎 Search Results', answer);
      if (primaryResult) {
        embed.setURL(primaryResult.url.trim());
      }
      const image = response.images?.find(
        candidate => typeof candidate?.url === 'string' && candidate.url.trim().length > 0
      );
      if (image) {
        embed.setImage(image.url.trim());
      }

      try {
        await textChannel.send({ embeds: [embed] });
      } catch (sendError) {
        logger.error(sendError, 'Failed to send search results to text channel');
      }

      const linkText = primaryResult ? `\n\nLink: ${primaryResult.url.trim()}` : '';
      respond(`${answer}${linkText}`, false);
    } catch (error) {
      logger.error(error, 'Tavily web search failed');
      respond('An error occurred while searching the web. Please try again later.', true);
    }
  };
}
