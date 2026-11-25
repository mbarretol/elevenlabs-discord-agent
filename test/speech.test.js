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
// The frame Discord clients send at the end of each transmission.
const OPUS_SILENCE_FRAME = Buffer.from([0xf8, 0xff, 0xfe]);
const HEAD_START_BYTES = 9_600;

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
    speechEnds: [],
    updates: [],
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
    markUserSpeechEnd(time) {
      this.speechEnds.push(time);
    },
    sendContextualUpdate(text) {
      this.updates.push(text);
    },
  };
}

async function createSession(getSpeakerName = async userId => `Name of ${userId}`) {
  const agent = createAgent();
  const connection = new FakeConnection();
  await new SpeechHandler(agent, connection, getSpeakerName).initialize();
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
  assert.equal(connection.subscriptions.length, 1);
  assert.equal(agent.audio.length, 1);

  // Once the stream has ended, the next speaker is picked up.
  first.stream.end();
  await once(first.stream, 'close');
  speaking.emit('start', 'user-2');
  assert.equal(connection.subscriptions.length, 2);
  assert.equal(connection.subscriptions[1].userId, 'user-2');
});

async function endStream(connection) {
  const { stream } = connection.subscriptions.at(-1);
  stream.end();
  await once(stream, 'close');
}

test('SpeechHandler names the speaker to the agent when the speaker changes', async () => {
  const { agent, connection, speaking } = await createSession();

  speaking.emit('start', 'user-1');
  await nextTick();
  assert.deepEqual(agent.updates, ['Name of user-1 is now speaking.']);

  // Someone talking over the current speaker is not streamed, so not named either.
  speaking.emit('start', 'user-2');
  await nextTick();
  assert.equal(agent.updates.length, 1);

  // The same speaker starting again is not named twice.
  await endStream(connection);
  speaking.emit('start', 'user-1');
  await nextTick();
  assert.equal(agent.updates.length, 1);

  await endStream(connection);
  speaking.emit('start', 'user-2');
  await nextTick();
  assert.deepEqual(agent.updates.slice(1), ['Name of user-2 is now speaking.']);
});

test('SpeechHandler still streams a speaker whose name cannot be found', async () => {
  const { agent, connection, speaking } = await createSession(async () => {
    throw new Error('Unknown Member');
  });

  speaking.emit('start', 'user-1');
  connection.subscriptions[0].stream.write(OPUS_PACKET);
  await nextTick();

  assert.deepEqual(agent.updates, []);
  assert.equal(agent.audio.length, 1);
});

test('SpeechHandler streams silence in real time while no one speaks', async t => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: 1_000 });
  const { agent, connection, speaking } = await createSession();

  t.mock.timers.tick(60);
  assert.equal(agent.audio.length, 3);
  assert.ok(agent.audio.every(chunk => chunk.byteLength === PCM_FRAME_BYTES));
  assert.ok(agent.audio.every(chunk => chunk.every(byte => byte === 0)));

  // No silence is mixed into the user's voice.
  agent.audio.length = 0;
  speaking.emit('start', 'user-1');
  const [{ stream }] = connection.subscriptions;
  for (let i = 0; i < 3; i++) {
    stream.write(OPUS_PACKET);
    await nextTick();
    t.mock.timers.tick(20);
  }
  assert.equal(agent.audio.length, 3);
  assert.deepEqual(agent.speechEnds, []);

  // Discord's end-of-transmission frames are dropped.
  stream.write(OPUS_SILENCE_FRAME);
  await nextTick();
  assert.equal(agent.audio.length, 3);

  // 60 ms after the last voice packet, the end of speech is marked with a head start of silence.
  t.mock.timers.tick(20);
  assert.deepEqual(agent.speechEnds, []);
  t.mock.timers.tick(20);
  assert.deepEqual(agent.speechEnds, [1_100]);
  assert.equal(agent.audio.length, 4);
  assert.equal(agent.audio[3].byteLength, HEAD_START_BYTES);

  // Then real-time silence resumes.
  t.mock.timers.tick(40);
  assert.equal(agent.audio.length, 6);
  assert.equal(agent.audio[5].byteLength, PCM_FRAME_BYTES);
  assert.equal(agent.speechEnds.length, 1);
});

test('SpeechHandler stops streaming silence when the voice connection is destroyed', async t => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'] });
  const { agent, connection } = await createSession();

  connection.destroy();
  t.mock.timers.tick(100);

  assert.deepEqual(agent.audio, []);
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
