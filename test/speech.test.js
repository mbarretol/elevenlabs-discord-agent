import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

process.env.DISCORD_BOT_TOKEN ??= 'test-token';
process.env.DISCORD_CLIENT_ID ??= 'test-client';
process.env.AGENT_ID ??= 'test-agent';

const { SpeechHandler } = await import('../dist/api/discord/speech.js');

class FakeSpeakingMap extends EventEmitter {
  users = new Map();
}

function createConnection() {
  const speaking = new FakeSpeakingMap();
  const subscriptions = new Map();
  const stateListeners = new Set();
  let destroyCount = 0;

  return {
    connection: {
      destroy() {
        destroyCount += 1;
      },
      off(event, listener) {
        if (event === 'stateChange') {
          stateListeners.delete(listener);
        }
      },
      on(event, listener) {
        if (event === 'stateChange') {
          stateListeners.add(listener);
        }
      },
      receiver: {
        speaking,
        subscribe(userId) {
          const stream = new PassThrough();
          subscriptions.set(userId, stream);
          return stream;
        },
      },
      rejoinAttempts: 0,
    },
    destroyCount: () => destroyCount,
    getStream: userId => subscriptions.get(userId),
    subscriptions,
  };
}

function createAgent() {
  const agent = new EventEmitter();
  agent.appendedAudio = [];
  agent.connect = async () => {};
  agent.disconnect = () => {};
  agent.appendInputAudio = buffer => {
    agent.appendedAudio.push(buffer.toString());
  };
  return agent;
}

test('SpeechHandler destroys the voice connection when the agent disconnects', async () => {
  const agent = createAgent();
  const { connection, destroyCount } = createConnection();
  const handler = new SpeechHandler(agent, connection);

  handler.decoder = { decode: buffer => buffer };

  await handler.initialize();
  agent.emit('disconnect');

  assert.equal(destroyCount(), 1);
});

test('SpeechHandler switches the upstream stream when speakers overlap', async () => {
  const agent = createAgent();
  const { connection, getStream, subscriptions } = createConnection();
  const handler = new SpeechHandler(agent, connection);

  handler.decoder = { decode: buffer => buffer };

  await handler.initialize();

  connection.receiver.speaking.users.set('user-1', Date.now());
  connection.receiver.speaking.emit('start', 'user-1');
  await new Promise(resolve => setImmediate(resolve));

  const firstStream = getStream('user-1');
  assert.ok(firstStream);

  firstStream.write(Buffer.from('speaker-one'));
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(agent.appendedAudio, ['speaker-one']);

  connection.receiver.speaking.users.set('user-2', Date.now());
  connection.receiver.speaking.emit('start', 'user-2');
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(subscriptions.has('user-2'), false);

  connection.receiver.speaking.users.delete('user-1');
  connection.receiver.speaking.emit('end', 'user-1');
  await new Promise(resolve => setImmediate(resolve));

  const secondStream = getStream('user-2');
  assert.ok(secondStream);

  secondStream.write(Buffer.from('speaker-two'));
  await new Promise(resolve => setImmediate(resolve));

  assert.deepEqual(agent.appendedAudio, ['speaker-one', 'speaker-two']);
});
