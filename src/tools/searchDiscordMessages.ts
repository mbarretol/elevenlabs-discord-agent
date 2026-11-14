import {
  ChannelType,
  type GuildBasedChannel,
  type GuildMember,
  PermissionFlagsBits,
  type RESTGetAPIGuildMessagesSearchResult,
  Routes,
} from 'discord.js';
import type { ClientTool } from '../api/elevenlabs/agent.js';

const DEFAULT_RESULT_LIMIT = 5;
const MAX_RESULT_LIMIT = 10;
const MAX_CONTENT_LENGTH = 500;

// Private threads are left out: channel permissions do not tell who may read them.
const SEARCHABLE_CHANNEL_TYPES = new Set([
  ChannelType.GuildText,
  ChannelType.GuildAnnouncement,
  ChannelType.GuildForum,
  ChannelType.PublicThread,
  ChannelType.AnnouncementThread,
]);

/**
 * Creates the `search_discord_messages` client tool. Its parameters are
 * declared in `src/config/elevenlabs/discord-agent.json`.
 *
 * The search runs with the bot's permissions, so named channels and
 * server-wide results are limited to what `member` can read.
 *
 * @param member - The member who started the voice session.
 * @param channelId - The channel searched by default.
 */
export function createSearchDiscordMessagesTool(
  member: GuildMember,
  channelId: string
): ClientTool {
  const { guild } = member;

  const canRead = (channel: GuildBasedChannel | undefined): boolean =>
    !!channel &&
    SEARCHABLE_CHANNEL_TYPES.has(channel.type) &&
    !!channel
      .permissionsFor(member)
      ?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory]);

  return async params => {
    const query = typeof params.query === 'string' ? params.query.trim() : '';
    const channelName = typeof params.channelName === 'string' ? params.channelName.trim() : '';
    const allChannels = params.allChannels === true;
    const mode = typeof params.mode === 'string' ? params.mode : query ? 'search' : 'latest';
    const limit =
      typeof params.limit === 'number' ? Math.trunc(params.limit) : DEFAULT_RESULT_LIMIT;

    const searchParams = new URLSearchParams({
      limit: String(Math.max(1, Math.min(MAX_RESULT_LIMIT, limit))),
    });
    if (query) searchParams.set('content', query);
    if (mode === 'first' || mode === 'latest') {
      searchParams.set('sort_by', 'timestamp');
      searchParams.set('sort_order', mode === 'first' ? 'asc' : 'desc');
    }

    // Without a channel the search covers the whole server.
    let searchChannelId: string | undefined;
    if (channelName) {
      const name = normalizeChannelName(channelName);
      searchChannelId = guild.channels.cache.find(
        channel => normalizeChannelName(channel.name) === name && canRead(channel)
      )?.id;
      if (!searchChannelId) throw new Error(`Could not find Discord channel '${channelName}'.`);
    } else if (!allChannels) {
      searchChannelId = channelId;
    }
    if (searchChannelId) searchParams.set('channel_id', searchChannelId);

    const result = (await guild.client.rest.get(Routes.guildMessagesSearch(guild.id), {
      query: searchParams,
    })) as RESTGetAPIGuildMessagesSearchResult;

    if ('retry_after' in result) {
      throw new Error(
        `Discord is still indexing this server. Try again in ${result.retry_after} seconds.`
      );
    }

    const messages = result.messages
      .flat()
      .filter(message => searchChannelId || canRead(guild.channels.cache.get(message.channel_id)));

    return JSON.stringify({
      // The server-wide total would count messages the member cannot read.
      totalResults: searchChannelId ? result.total_results : messages.length,
      results: messages.map(message => ({
        author: message.author.global_name ?? message.author.username,
        timestamp: message.timestamp,
        content: (message.content.trim() || '[content unavailable]').slice(0, MAX_CONTENT_LENGTH),
        url: `https://discord.com/channels/${guild.id}/${message.channel_id}/${message.id}`,
      })),
    });
  };
}

function normalizeChannelName(channelName: string): string {
  return channelName.trim().replace(/^#/, '').toLowerCase();
}
