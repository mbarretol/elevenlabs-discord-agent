import test from 'node:test';
import assert from 'node:assert/strict';
import { ChannelType, Collection } from 'discord.js';
import { createSearchDiscordMessagesTool } from '../dist/tools/searchDiscordMessages.js';

function channel(id, name, { readable = true, type = ChannelType.GuildText } = {}) {
  return { id, name, type, permissionsFor: () => ({ has: () => readable }) };
}

function message(id, channelId, content) {
  return {
    id,
    channel_id: channelId,
    author: { id: 'user-1', username: 'marco', global_name: 'Marco' },
    timestamp: '2026-06-03T10:15:00.000Z',
    content,
  };
}

function createTool({ channels = [], messages = [], response } = {}) {
  const requests = [];
  const member = {
    guild: {
      id: 'guild-1',
      channels: { cache: new Collection(channels.map(channel => [channel.id, channel])) },
      client: {
        rest: {
          async get(route, { query }) {
            requests.push({ route, query });
            return response ?? { total_results: 42, messages: messages.map(message => [message]) };
          },
        },
      },
    },
  };

  const tool = createSearchDiscordMessagesTool(member, 'current-channel');
  return { requests, search: async parameters => JSON.parse(await tool(parameters)) };
}

test('search covers the current channel by default and formats the results', async () => {
  const { requests, search } = createTool({
    messages: [message('message-1', 'current-channel', ' deploy went through ')],
  });

  const result = await search({ query: ' deploy ', limit: 2 });

  assert.equal(requests.length, 1);
  assert.equal(requests[0].route, '/guilds/guild-1/messages/search');
  assert.equal(requests[0].query.toString(), 'limit=2&content=deploy&channel_id=current-channel');
  assert.deepEqual(result, {
    totalResults: 42,
    results: [
      {
        author: 'Marco',
        timestamp: '2026-06-03T10:15:00.000Z',
        content: 'deploy went through',
        url: 'https://discord.com/channels/guild-1/current-channel/message-1',
      },
    ],
  });
});

test('search clamps the limit and marks messages without readable content', async () => {
  const { requests, search } = createTool({
    messages: [message('message-1', 'current-channel', '')],
  });

  const result = await search({ query: 'deploy', limit: 50 });

  assert.equal(requests[0].query.get('limit'), '10');
  assert.equal(result.results[0].content, '[content unavailable]');
});

test('search returns the latest messages when there is no query', async () => {
  const { requests, search } = createTool();

  await search({});

  assert.equal(
    requests[0].query.toString(),
    'limit=5&sort_by=timestamp&sort_order=desc&channel_id=current-channel'
  );
});

test('search resolves a channel by name and supports first-message mode', async () => {
  const { requests, search } = createTool({ channels: [channel('test-channel', 'test')] });

  await search({ channelName: '#Test', mode: 'first', limit: 1 });

  assert.equal(
    requests[0].query.toString(),
    'limit=1&sort_by=timestamp&sort_order=asc&channel_id=test-channel'
  );
});

test('search does not resolve channels the member cannot read', async () => {
  const { requests, search } = createTool({
    channels: [
      channel('mod-channel', 'mods', { readable: false }),
      channel('thread-1', 'secret', { type: ChannelType.PrivateThread }),
      channel('category-1', 'archive', { type: ChannelType.GuildCategory }),
    ],
  });

  for (const channelName of ['mods', 'secret', 'archive', 'nowhere']) {
    await assert.rejects(search({ channelName }), {
      message: `Could not find Discord channel '${channelName}'.`,
    });
  }
  assert.equal(requests.length, 0);
});

test('server-wide search drops messages from channels the member cannot read', async () => {
  const { requests, search } = createTool({
    channels: [channel('general', 'general'), channel('mod-channel', 'mods', { readable: false })],
    messages: [
      message('message-1', 'general', 'public'),
      message('message-2', 'mod-channel', 'hidden'),
      message('message-3', 'uncached-channel', 'unknown'),
    ],
  });

  const result = await search({ query: 'anything', allChannels: true });

  assert.equal(requests[0].query.has('channel_id'), false);
  assert.equal(result.totalResults, 1);
  assert.deepEqual(
    result.results.map(message => message.content),
    ['public']
  );
});

test('search fails while Discord is still indexing the server', async () => {
  const { search } = createTool({
    response: { message: 'Index not yet available', code: 110000, retry_after: 2 },
  });

  await assert.rejects(search({ query: 'deploy' }), /Try again in 2 seconds/);
});
