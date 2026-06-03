import { Routes } from 'discord.js';
import type { APIMessage, RESTGetAPIGuildMessagesSearchResult } from 'discord.js';

const DEFAULT_RESULT_LIMIT = 5;
const MAX_RESULT_LIMIT = 10;
const MAX_QUERY_LENGTH = 1024;
const MAX_CONTENT_LENGTH = 500;

interface DiscordRestClient {
  get(route: `/${string}`, options?: { query?: URLSearchParams }): Promise<unknown>;
}

export interface DiscordMessageSearchContext {
  rest: DiscordRestClient;
  guildId: string;
  channelId?: string;
  resolveChannelId?: (channelName: string) => string | undefined;
}

type MessageSearchParams = Record<string, unknown>;
type SearchMode = 'search' | 'first' | 'latest';

interface SearchResultMessage {
  id: string;
  channelId: string;
  author: string;
  authorId: string;
  timestamp: string;
  content: string;
  url: string;
}

interface ToolSearchResult {
  mode: SearchMode;
  query?: string;
  totalResults: number;
  returned: number;
  results: SearchResultMessage[];
}

interface IndexNotReadyResult {
  unavailable: true;
  message: string;
  retryAfterSeconds: number;
  documentsIndexed: number;
}

export function createSearchDiscordMessagesTool(context?: DiscordMessageSearchContext) {
  return {
    names: ['search_discord_messages', 'discord_search_messages', 'searchDiscordMessages'],
    execute: (params: MessageSearchParams) => searchDiscordMessages(params, context),
  };
}

async function searchDiscordMessages(
  params: MessageSearchParams,
  context?: DiscordMessageSearchContext
): Promise<string> {
  if (!context) {
    throw new Error('Discord message search is unavailable in this session.');
  }

  const query = getString(params, 'query') ?? getString(params, 'content');
  const mode = getMode(params, query);

  const searchParams = new URLSearchParams();
  if (query) {
    searchParams.set('content', query.slice(0, MAX_QUERY_LENGTH));
  }
  searchParams.set('limit', String(getLimit(params.limit)));

  const channelIds = getChannelIds(params, context);
  if (channelIds.length > 0) {
    channelIds.forEach(channelId => searchParams.append('channel_id', channelId));
  } else if (context.channelId && params.allChannels !== true && params.all_channels !== true) {
    searchParams.append('channel_id', context.channelId);
  }

  appendNumber(searchParams, 'offset', params.offset, 0, 9975);
  appendNumber(searchParams, 'slop', params.slop, 0, 100);
  appendStringList(searchParams, 'author_type', params.authorType ?? params.author_type);
  appendStringList(searchParams, 'author_id', params.authorId ?? params.author_id);
  appendStringList(searchParams, 'mentions', params.mentions);
  appendStringList(
    searchParams,
    'mentions_role_id',
    params.roleMentionId ?? params.mentions_role_id
  );
  appendStringList(
    searchParams,
    'replied_to_user_id',
    params.repliedToUserId ?? params.replied_to_user_id
  );
  appendStringList(
    searchParams,
    'replied_to_message_id',
    params.repliedToMessageId ?? params.replied_to_message_id
  );
  appendStringList(searchParams, 'has', params.has);
  appendStringList(searchParams, 'embed_type', params.embedType ?? params.embed_type);
  appendStringList(searchParams, 'embed_provider', params.embedProvider ?? params.embed_provider);
  appendStringList(searchParams, 'link_hostname', params.linkHostname ?? params.link_hostname);
  appendStringList(
    searchParams,
    'attachment_filename',
    params.attachmentFilename ?? params.attachment_filename
  );
  appendStringList(
    searchParams,
    'attachment_extension',
    params.attachmentExtension ?? params.attachment_extension
  );

  appendString(searchParams, 'max_id', params.beforeMessageId ?? params.max_id);
  appendString(searchParams, 'min_id', params.afterMessageId ?? params.min_id);
  appendBoolean(
    searchParams,
    'mention_everyone',
    params.mentionEveryone ?? params.mention_everyone
  );
  appendBoolean(searchParams, 'pinned', params.pinned);
  appendBoolean(searchParams, 'include_nsfw', params.includeNsfw ?? params.include_nsfw);
  appendModeSort(searchParams, mode);
  appendSort(searchParams, params);

  const route = Routes.guildMessagesSearch(context.guildId) as `/${string}`;
  const result = (await context.rest.get(route, {
    query: searchParams,
  })) as RESTGetAPIGuildMessagesSearchResult;

  if ('retry_after' in result) {
    return JSON.stringify({
      unavailable: true,
      message: result.message,
      retryAfterSeconds: result.retry_after,
      documentsIndexed: result.documents_indexed,
    } satisfies IndexNotReadyResult);
  }

  const messages = result.messages.flat().slice(0, MAX_RESULT_LIMIT);
  const response: ToolSearchResult = {
    mode,
    ...(query ? { query } : {}),
    totalResults: result.total_results,
    returned: messages.length,
    results: messages.map(message => formatMessage(message, context.guildId)),
  };

  return JSON.stringify(response);
}

function getString(params: MessageSearchParams, key: string): string | undefined {
  const value = params[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function getLimit(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_RESULT_LIMIT;
  return Math.max(1, Math.min(MAX_RESULT_LIMIT, Math.trunc(value)));
}

function getMode(params: MessageSearchParams, query: string | undefined): SearchMode {
  const mode = getString(params, 'mode');
  if (mode === 'first' || mode === 'latest' || mode === 'search') return mode;
  return query ? 'search' : 'latest';
}

function getChannelIds(
  params: MessageSearchParams,
  context: DiscordMessageSearchContext
): string[] {
  const channelIds = getStringList(params.channelId ?? params.channel_id);
  if (channelIds.length > 0) return channelIds;

  const channelName =
    getString(params, 'channelName') ??
    getString(params, 'channel_name') ??
    getString(params, 'channel');
  if (!channelName) return [];

  const channelId = context.resolveChannelId?.(channelName);
  if (!channelId) {
    throw new Error(`Could not find Discord channel '${channelName}'.`);
  }

  return [channelId];
}

function getStringList(value: unknown): string[] {
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  if (!Array.isArray(value)) return [];

  return value
    .filter((item): item is string => typeof item === 'string' && item.trim() !== '')
    .map(item => item.trim());
}

function appendString(searchParams: URLSearchParams, key: string, value: unknown): void {
  if (typeof value === 'string' && value.trim()) {
    searchParams.set(key, value.trim());
  }
}

function appendStringList(searchParams: URLSearchParams, key: string, value: unknown): void {
  getStringList(value).forEach(item => searchParams.append(key, item));
}

function appendNumber(
  searchParams: URLSearchParams,
  key: string,
  value: unknown,
  min: number,
  max: number
): void {
  if (typeof value !== 'number' || !Number.isFinite(value)) return;

  const clamped = Math.max(min, Math.min(max, Math.trunc(value)));
  searchParams.set(key, String(clamped));
}

function appendBoolean(searchParams: URLSearchParams, key: string, value: unknown): void {
  if (typeof value === 'boolean') {
    searchParams.set(key, String(value));
  }
}

function appendModeSort(searchParams: URLSearchParams, mode: SearchMode): void {
  if (mode === 'first') {
    searchParams.set('sort_by', 'timestamp');
    searchParams.set('sort_order', 'asc');
    return;
  }

  if (mode === 'latest') {
    searchParams.set('sort_by', 'timestamp');
    searchParams.set('sort_order', 'desc');
  }
}

function appendSort(searchParams: URLSearchParams, params: MessageSearchParams): void {
  const sortBy = getString(params, 'sortBy') ?? getString(params, 'sort_by');
  if (sortBy === 'timestamp' || sortBy === 'relevance') {
    searchParams.set('sort_by', sortBy);
  }

  const sortOrder = getString(params, 'sortOrder') ?? getString(params, 'sort_order');
  if (sortOrder === 'asc' || sortOrder === 'desc') {
    searchParams.set('sort_order', sortOrder);
  }
}

function formatMessage(
  message: Omit<APIMessage, 'reactions'>,
  guildId: string
): SearchResultMessage {
  const content = message.content.trim() || '[content unavailable]';
  const authorName = message.author.global_name ?? message.author.username ?? message.author.id;

  return {
    id: message.id,
    channelId: message.channel_id,
    author: authorName,
    authorId: message.author.id,
    timestamp: message.timestamp,
    content: content.slice(0, MAX_CONTENT_LENGTH),
    url: `https://discord.com/channels/${guildId}/${message.channel_id}/${message.id}`,
  };
}
