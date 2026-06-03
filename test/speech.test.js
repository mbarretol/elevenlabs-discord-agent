import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { EndBehaviorType, VoiceConnectionStatus } from '@discordjs/voice';

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
  const subscriptionOptions = new Map();
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
        subscribe(userId, options) {
          const stream = new PassThrough();
          subscriptions.set(userId, stream);
          subscriptionOptions.set(userId, options);
          return stream;
        },
      },
      rejoinAttempts: 0,
    },
    destroyCount: () => destroyCount,
    emitStateChange: async newState => {
      await Promise.all([...stateListeners].map(listener => listener({}, newState)));
    },
    getStream: userId => subscriptions.get(userId),
    getSubscriptionOptions: userId => subscriptionOptions.get(userId),
    stateListenerCount: () => stateListeners.size,
    subscriptions,
  };
}

function createAgent() {
  const agent = new EventEmitter();
  agent.appendedAudio = [];
  agent.connect = async () => {};
  agent.disconnectCalls = 0;
  agent.disconnect = () => {
    agent.disconnectCalls += 1;
  };
  agent.appendInputAudio = buffer => {
    agent.appendedAudio.push(Buffer.from(buffer));
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

test('SpeechHandler recreates receive streams after inactivity', async () => {
  const agent = createAgent();
  const { connection, getStream, getSubscriptionOptions, subscriptions } = createConnection();
  const handler = new SpeechHandler(agent, connection);

  handler.decoder = { decode: buffer => buffer };

  await handler.initialize();

  connection.receiver.speaking.users.set('user-1', Date.now());
  connection.receiver.speaking.emit('start', 'user-1');
  await new Promise(resolve => setImmediate(resolve));

  const firstStream = getStream('user-1');
  assert.ok(firstStream);
  assert.equal(getSubscriptionOptions('user-1').end.behavior, EndBehaviorType.AfterInactivity);
  assert.equal(getSubscriptionOptions('user-1').end.duration, 300);

  firstStream.write(Buffer.from('speaker-one'));
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(
    agent.appendedAudio.map(buffer => buffer.toString()),
    ['speaker-one']
  );

  connection.receiver.speaking.users.set('user-2', Date.now());
  connection.receiver.speaking.emit('start', 'user-2');
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(subscriptions.has('user-2'), false);

  connection.receiver.speaking.users.delete('user-1');
  connection.receiver.speaking.emit('end', 'user-1');
  connection.receiver.speaking.emit('end', 'user-2');
  firstStream.end();
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(firstStream.destroyed, true);
  assert.equal(subscriptions.has('user-2'), false);
  assert.equal(agent.appendedAudio[1].byteLength, 9_600);
  assert.equal(agent.appendedAudio[1].every(byte => byte === 0), true);

  connection.receiver.speaking.users.set('user-1', Date.now());
  connection.receiver.speaking.emit('start', 'user-1');
  await new Promise(resolve => setImmediate(resolve));

  const secondStream = getStream('user-1');
  assert.ok(secondStream);
  assert.notEqual(secondStream, firstStream);

  secondStream.write(Buffer.from('speaker-two'));
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(agent.appendedAudio[0].toString(), 'speaker-one');
  assert.deepEqual(agent.appendedAudio[2].toString(), 'speaker-two');

  secondStream.destroy();
});

test('SpeechHandler cleans up streams and listeners when the voice connection is destroyed', async () => {
  const agent = createAgent();
  const {
    connection,
    destroyCount,
    emitStateChange,
    getStream,
    stateListenerCount,
    subscriptions,
  } = createConnection();
  const handler = new SpeechHandler(agent, connection);

  handler.decoder = { decode: buffer => buffer };

  await handler.initialize();

  connection.receiver.speaking.emit('start', 'user-1');
  await new Promise(resolve => setImmediate(resolve));

  const stream = getStream('user-1');
  assert.ok(stream);

  await emitStateChange({ status: VoiceConnectionStatus.Destroyed });
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(stream.destroyed, true);
  assert.equal(agent.disconnectCalls, 1);
  assert.equal(connection.receiver.speaking.listenerCount('start'), 0);
  assert.equal(connection.receiver.speaking.listenerCount('end'), 0);
  assert.equal(stateListenerCount(), 0);
  assert.equal(agent.listenerCount('disconnect'), 0);

  connection.receiver.speaking.emit('start', 'user-2');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(subscriptions.has('user-2'), false);

  agent.emit('disconnect');
  assert.equal(destroyCount(), 0);
});
