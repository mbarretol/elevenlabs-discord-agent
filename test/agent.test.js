import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { setTimeout as sleep } from 'node:timers/promises';
import { AudioPlayerStatus, createAudioPlayer } from '@discordjs/voice';
import { WebSocketServer } from 'ws';
import { Agent } from '../dist/api/elevenlabs/agent.js';
import { logger } from '../dist/config/logger.js';

const AUDIO_EVENT = {
  type: 'audio',
  audio_event: { audio_base_64: Buffer.alloc(1920).toString('base64') },
};

/**
 * Connects an Agent to a local WebSocket server standing in for ElevenLabs.
 */
async function startSession(t, tools = {}) {
  const server = new WebSocketServer({ port: 0 });
  await once(server, 'listening');

  const audioPlayer = createAudioPlayer();
  const played = [];
  const play = audioPlayer.play.bind(audioPlayer);
  audioPlayer.play = resource => {
    played.push(resource);
    play(resource);
  };

  const agent = new Agent({
    url: `ws://127.0.0.1:${server.address().port}`,
    audioPlayer,
    tools: { ...tools, sync: async () => 'synced' },
  });
  let closes = 0;
  const [[remote]] = await Promise.all([
    once(server, 'connection'),
    agent.connect(() => {
      closes += 1;
    }),
  ]);

  t.after(() => {
    agent.disconnect();
    server.close();
  });

  const sendEvent = event => remote.send(JSON.stringify(event));
  const receiveEvent = async () => JSON.parse((await once(remote, 'message'))[0].toString());
  const callTool = async (tool_name, parameters) => {
    sendEvent({
      type: 'client_tool_call',
      client_tool_call: { tool_name, tool_call_id: 'call-1', parameters },
    });
    return receiveEvent();
  };

  return {
    agent,
    audioPlayer,
    played,
    remote,
    closes: () => closes,
    sendEvent,
    receiveEvent,
    callTool,
    // Events are handled in order, so a tool result means everything sent before it was handled.
    flush: () => callTool('sync'),
  };
}

async function waitFor(condition) {
  for (let attempt = 0; attempt < 200 && !condition(); attempt++) {
    await sleep(5);
  }
  assert.ok(condition(), 'Timed out waiting for condition');
}

test('Agent sends user audio as base64 chunks until it is disconnected', async t => {
  const { agent, receiveEvent, flush, remote } = await startSession(t);

  agent.appendInputAudio(Buffer.from('hello'));
  assert.deepEqual(await receiveEvent(), { user_audio_chunk: 'aGVsbG8=' });

  await flush();
  const received = [];
  remote.on('message', data => received.push(data.toString()));
  agent.disconnect();
  agent.appendInputAudio(Buffer.from('ignored'));
  await once(remote, 'close');

  assert.deepEqual(received, []);
});

test('Agent rejects connect and reports the close when ElevenLabs is unreachable', async () => {
  const server = new WebSocketServer({ port: 0 });
  await once(server, 'listening');
  const { port } = server.address();
  server.close();
  await once(server, 'close');

  const agent = new Agent({ url: `ws://127.0.0.1:${port}`, audioPlayer: createAudioPlayer() });
  let closes = 0;

  await assert.rejects(
    agent.connect(() => {
      closes += 1;
    })
  );
  await waitFor(() => closes === 1);
});

test('Agent reports a remote close', async t => {
  const { remote, closes } = await startSession(t);

  remote.close();

  await waitFor(() => closes() === 1);
});

test('Agent does not report its own disconnect', async t => {
  const { agent, remote, closes } = await startSession(t);

  agent.disconnect();
  await once(remote, 'close');
  await sleep(20);

  assert.equal(closes(), 0);
});

test('Agent survives a WebSocket protocol error and reports the close', async t => {
  const { remote, closes } = await startSession(t);

  // RSV bits set without a negotiated extension is a protocol violation.
  remote._socket.write(Buffer.from([0xff, 0xff, 0xff, 0xff]));

  await waitFor(() => closes() === 1);
});

test('Agent runs client tools and sends back their result', async t => {
  const calls = [];
  const { callTool } = await startSession(t, {
    lookup: async parameters => {
      calls.push(parameters);
      return 'tool result';
    },
  });

  const result = await callTool('lookup', { value: 'x' });

  assert.deepEqual(calls, [{ value: 'x' }]);
  assert.deepEqual(result, {
    type: 'client_tool_result',
    tool_call_id: 'call-1',
    result: 'tool result',
    is_error: false,
  });
});

test('Agent sends an error result when a client tool is unknown or fails', async t => {
  const { callTool } = await startSession(t, {
    broken: async () => {
      throw new Error('boom');
    },
  });

  assert.deepEqual(await callTool('missing', {}), {
    type: 'client_tool_result',
    tool_call_id: 'call-1',
    result: "Error: Unsupported tool 'missing'.",
    is_error: true,
  });
  assert.deepEqual(await callTool('broken', {}), {
    type: 'client_tool_result',
    tool_call_id: 'call-1',
    result: 'Error: boom',
    is_error: true,
  });
});

test('Agent keeps one playback per response and starts a new one after an interruption', async t => {
  const { played, sendEvent, flush } = await startSession(t);

  sendEvent(AUDIO_EVENT);
  sendEvent(AUDIO_EVENT);
  await flush();
  assert.equal(played.length, 1);

  sendEvent({ type: 'interruption' });
  sendEvent(AUDIO_EVENT);
  sendEvent(AUDIO_EVENT);
  await flush();
  assert.equal(played.length, 2);
  assert.notEqual(played[1], played[0]);
});

test('Agent stops playback when it is disconnected', async t => {
  const { agent, audioPlayer, sendEvent, flush } = await startSession(t);
  const errors = [];
  audioPlayer.on('error', error => errors.push(error));

  sendEvent(AUDIO_EVENT);
  await flush();
  assert.notEqual(audioPlayer.state.status, AudioPlayerStatus.Idle);

  agent.disconnect();
  await sleep(20);

  assert.equal(audioPlayer.state.status, AudioPlayerStatus.Idle);
  assert.deepEqual(errors, []);
});

test('Agent answers pings', async t => {
  const { sendEvent, receiveEvent } = await startSession(t);

  sendEvent({ type: 'ping', ping_event: { event_id: 7, ping_ms: 42 } });

  assert.deepEqual(await receiveEvent(), { type: 'pong', event_id: 7 });
});

test('Agent logs the response latency once per user turn', async t => {
  const { agent, sendEvent, flush } = await startSession(t);
  const logs = [];
  t.mock.method(logger, 'info', message => logs.push(message));
  const latencyLogs = () => logs.filter(message => message.startsWith('Latency:'));

  sendEvent({ type: 'ping', ping_event: { event_id: 1, ping_ms: 42 } });
  agent.markUserSpeechEnd(Date.now() - 500);
  sendEvent({ type: 'user_transcript', user_transcription_event: { user_transcript: 'hi' } });
  sendEvent(AUDIO_EVENT);
  sendEvent(AUDIO_EVENT);
  await flush();

  assert.equal(latencyLogs().length, 1);
  assert.match(
    latencyLogs()[0],
    /^Latency: agent audio \d+ ms after end of speech \(transcript: \d+ ms, network round trip: 42 ms\)$/
  );
  const [, total] = latencyLogs()[0].match(/agent audio (\d+) ms/);
  assert.ok(Number(total) >= 500);
});
