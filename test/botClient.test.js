import test from 'node:test';
import assert from 'node:assert/strict';

process.env.DISCORD_BOT_TOKEN ??= 'test-token';
process.env.DISCORD_CLIENT_ID ??= 'test-client';
process.env.AGENT_ID ??= 'test-agent';

const { Bot } = await import('../dist/botClient.js');

test('Bot.handleCommand replies when the requested command is unavailable', async () => {
  const bot = new Bot({ intents: [] });
  const replies = [];
  const interaction = {
    commandName: 'talk',
    deferred: false,
    replied: false,
    followUp: async payload => {
      replies.push({ method: 'followUp', payload });
    },
    reply: async payload => {
      replies.push({ method: 'reply', payload });
    },
  };

  await bot.handleCommand(interaction);

  assert.deepEqual(replies, [
    {
      method: 'reply',
      payload: {
        content: 'This command is currently unavailable. Please try again in a moment.',
        ephemeral: true,
      },
    },
  ]);

  bot.destroy();
});
