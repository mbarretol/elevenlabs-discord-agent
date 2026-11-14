import test from 'node:test';
import assert from 'node:assert/strict';
import { commandMap, handleCommand } from '../dist/commands/index.js';

const FAILURE_REPLY = { content: 'Command execution failed!', flags: 64 };

function createInteraction(overrides) {
  const replies = [];
  return {
    replies,
    deferred: false,
    replied: false,
    followUp: async payload => {
      replies.push({ method: 'followUp', payload });
    },
    reply: async payload => {
      replies.push({ method: 'reply', payload });
    },
    ...overrides,
  };
}

function registerFailingCommand(t) {
  const name = 'throwing-test-command';
  commandMap.set(name, {
    execute: async () => {
      throw new Error('test failure');
    },
  });
  t.after(() => commandMap.delete(name));
  return name;
}

test('command registry exposes the supported slash commands', () => {
  assert.deepEqual([...commandMap.keys()].sort(), ['leave', 'talk']);
});

test('handleCommand replies when the command is unknown', async () => {
  const interaction = createInteraction({ commandName: 'missing' });

  await handleCommand(interaction);

  assert.deepEqual(interaction.replies, [{ method: 'reply', payload: FAILURE_REPLY }]);
});

test('handleCommand follows up when a deferred command fails', async t => {
  const interaction = createInteraction({
    commandName: registerFailingCommand(t),
    deferred: true,
  });

  await handleCommand(interaction);

  assert.deepEqual(interaction.replies, [{ method: 'followUp', payload: FAILURE_REPLY }]);
});

test('handleCommand does not reject when the failure reply fails too', async t => {
  const interaction = createInteraction({
    commandName: registerFailingCommand(t),
    reply: async () => {
      throw new Error('Unknown interaction');
    },
  });

  await handleCommand(interaction);
});
