import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { PassThrough } from 'node:stream';
import opus from '@discordjs/opus';
import { EndBehaviorType, VoiceConnectionStatus } from '@discordjs/voice';
import { SpeechHandler } from '../dist/api/discord/speech.js';

// 20 ms of 16 kHz mono audio, as an Opus packet and as the PCM it decodes to.
const PCM_FRAME_BYTES = 640;
const OPUS_PACKET = new opus.OpusEncoder(16_000, 1).encode(Buffer.alloc(PCM_FRAME_BYTES));

class FakeConnection extends EventEmitter {
  state = { status: VoiceConnectionStatus.Ready };
  subscriptions = [];
  destroyCalls = 0;
  receiver = {
    speaking: new EventEmitter(),
    subscribe: (userId, options) => {
      const stream = new PassThrough({ objectMode: true });
      this.subscriptions.push({ userId, options, stream });
      return stream;
    },
  };

  setStatus(status) {
    const oldState = this.state;
    this.state = { status };
    this.emit(status, oldState, this.state);
  }

  destroy() {
    if (this.state.status === VoiceConnectionStatus.Destroyed) {
      throw new Error('Cannot destroy VoiceConnection - it has already been destroyed');
    }
    this.destroyCalls += 1;
    this.setStatus(VoiceConnectionStatus.Destroyed);
  }
}

function createAgent() {
  return {
    audio: [],
    disconnects: 0,
    async connect(onClose) {
      this.onClose = onClose;
    },
    disconnect() {
      this.disconnects += 1;
    },
    appendInputAudio(buffer) {
      this.audio.push(buffer);
    },
  };
}

async function createSession() {
  const agent = createAgent();
  const connection = new FakeConnection();
  await new SpeechHandler(agent, connection).initialize();
  return { agent, connection, speaking: connection.receiver.speaking };
}

const nextTick = () => new Promise(resolve => setImmediate(resolve));

test('SpeechHandler streams one speaker at a time to the agent', async () => {
  const { agent, connection, speaking } = await createSession();

  speaking.emit('start', 'user-1');
  const [first] = connection.subscriptions;
  assert.equal(first.userId, 'user-1');
  assert.deepEqual(first.options, {
    end: { behavior: EndBehaviorType.AfterInactivity, duration: 300 },
  });

  first.stream.write(OPUS_PACKET);
  await nextTick();
  assert.equal(agent.audio.length, 1);
  assert.equal(agent.audio[0].byteLength, PCM_FRAME_BYTES);

  // A second speaker is ignored while the first is being streamed.
  speaking.emit('start', 'user-2');
  speaking.emit('end', 'user-2');
  assert.equal(connection.subscriptions.length, 1);
  assert.equal(agent.audio.length, 1);

  // The active speaker going quiet is marked with 300 ms of silence.
  speaking.emit('end', 'user-1');
  assert.equal(agent.audio.length, 2);
  assert.equal(agent.audio[1].byteLength, 9_600);
  assert.ok(agent.audio[1].every(byte => byte === 0));

  // Once the stream has ended, the next speaker is picked up.
  first.stream.end();
  await once(first.stream, 'close');
  speaking.emit('start', 'user-2');
  assert.equal(connection.subscriptions.length, 2);
  assert.equal(connection.subscriptions[1].userId, 'user-2');
});

test('SpeechHandler skips packets that cannot be decoded', async () => {
  const { agent, connection, speaking } = await createSession();

  speaking.emit('start', 'user-1');
  const [{ stream }] = connection.subscriptions;
  stream.write(Buffer.from('not opus'));
  stream.write(OPUS_PACKET);
  await nextTick();

  assert.equal(agent.audio.length, 1);
});

test('SpeechHandler destroys the voice connection when the agent closes', async () => {
  const { agent, connection } = await createSession();

  agent.onClose();

  assert.equal(connection.destroyCalls, 1);
});

test('SpeechHandler ends the session when the voice connection is destroyed', async () => {
  const { agent, connection, speaking } = await createSession();
  speaking.emit('start', 'user-1');
  const [{ stream }] = connection.subscriptions;

  connection.destroy();

  assert.equal(stream.destroyed, true);
  assert.equal(agent.disconnects, 1);
});

test('SpeechHandler destroys a voice connection that does not reconnect', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { connection } = await createSession();

  connection.setStatus(VoiceConnectionStatus.Disconnected);
  t.mock.timers.tick(5_000);
  await nextTick();

  assert.equal(connection.destroyCalls, 1);
});

test('SpeechHandler keeps a voice connection that is reconnecting', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { agent, connection } = await createSession();

  connection.setStatus(VoiceConnectionStatus.Disconnected);
  connection.setStatus(VoiceConnectionStatus.Connecting);
  await nextTick();
  t.mock.timers.tick(5_000);
  await nextTick();

  assert.equal(connection.destroyCalls, 0);
  assert.equal(agent.disconnects, 0);
});

test('SpeechHandler tolerates the connection being destroyed while it waits to reconnect', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { connection } = await createSession();

  connection.setStatus(VoiceConnectionStatus.Disconnected);
  connection.destroy();
  t.mock.timers.tick(5_000);
  await nextTick();

  // A second destroy() would throw, as it does on a real VoiceConnection.
  assert.equal(connection.destroyCalls, 1);
});
