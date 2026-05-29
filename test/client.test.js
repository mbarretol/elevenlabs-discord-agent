import test from 'node:test';
import assert from 'node:assert/strict';

process.env.DISCORD_BOT_TOKEN ??= 'test-token';
process.env.DISCORD_CLIENT_ID ??= 'test-client';
process.env.AGENT_ID ??= 'test-agent';

const { commandMap } = await import('../dist/commands/index.js');
const { handleCommand } = await import('../dist/api/discord/client.js');

test('command registry exposes the supported slash commands', () => {
  assert.deepEqual([...commandMap.keys()].sort(), ['leave', 'talk']);
});

test('handleCommand replies when the requested command is unavailable', async () => {
  const replies = [];
  const interaction = {
    commandName: 'missing',
    deferred: false,
    replied: false,
    followUp: async payload => {
      replies.push({ method: 'followUp', payload });
    },
    reply: async payload => {
      replies.push({ method: 'reply', payload });
    },
  };

  await handleCommand(interaction);

  assert.deepEqual(replies, [
    {
      method: 'reply',
      payload: {
        content: 'This command is currently unavailable. Please try again in a moment.',
        flags: 64,
      },
    },
  ]);
});
