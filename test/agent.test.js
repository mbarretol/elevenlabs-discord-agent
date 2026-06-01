import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { logger } from '../dist/config/logger.js';

process.env.DISCORD_BOT_TOKEN ??= 'test-token';
process.env.DISCORD_CLIENT_ID ??= 'test-client';
process.env.AGENT_ID ??= 'test-agent';

const { Agent } = await import('../dist/api/elevenlabs/agent.js');

function createAudioPlayer() {
  return {
    off() {},
    on() {},
    play() {},
    stop() {},
  };
}

function pcm16(...samples) {
  const buffer = Buffer.alloc(samples.length * 2);
  samples.forEach((sample, index) => {
    buffer.writeInt16LE(sample, index * 2);
  });
  return buffer;
}

test('Agent emits disconnect when the websocket closes remotely', () => {
  const agent = new Agent(createAudioPlayer());

  agent.socket = {
    close() {},
    off() {},
    readyState: 1,
  };
  agent.pcmStream = new PassThrough();

  let disconnects = 0;
  agent.on('disconnect', () => {
    disconnects += 1;
  });

  agent.handleSocketClose(1000, Buffer.from('normal closure'));

  assert.equal(disconnects, 1);
  assert.equal(agent.socket, null);
  assert.equal(agent.pcmStream, null);
});

test('Agent logs raw conversation text', () => {
  const agent = new Agent(createAudioPlayer());
  const originalInfo = logger.info;
  const messages = [];

  logger.info = (...args) => {
    messages.push(args.join(' '));
  };

  try {
    agent.handleAgentResponse({
      type: 'agent_response',
      agent_response_event: { agent_response: 'top secret answer' },
    });
    agent.handleUserTranscript({
      type: 'user_transcript',
      user_transcription_event: { user_transcript: 'my private note' },
    });
  } finally {
    logger.info = originalInfo;
  }

  assert.deepEqual(messages, [
    'Agent Response: top secret answer',
    'User Transcript: "my private note"',
  ]);
});

test('Agent sends input audio chunks as base64 only when the websocket is open', () => {
  const agent = new Agent(createAudioPlayer());
  const sent = [];

  agent.socket = {
    readyState: 1,
    send(message) {
      sent.push(JSON.parse(message));
    },
  };

  agent.appendInputAudio(Buffer.from('hello'));
  agent.appendInputAudio(Buffer.alloc(0));

  agent.socket.readyState = 3;
  agent.appendInputAudio(Buffer.from('closed'));

  assert.deepEqual(sent, [{ user_audio_chunk: 'aGVsbG8=' }]);
});

test('Agent sends an error result for unsupported client tool calls', async () => {
  const agent = new Agent(createAudioPlayer());
  const sent = [];

  agent.socket = {
    readyState: 1,
    send(message) {
      sent.push(JSON.parse(message));
    },
  };

  await agent.handleEvent(
    Buffer.from(
      JSON.stringify({
        type: 'client_tool_call',
        client_tool_call: {
          tool_name: 'lookup',
          tool_call_id: 'call-1',
          parameters: { query: 'current time' },
        },
      })
    )
  );

  assert.deepEqual(sent, [
    {
      type: 'client_tool_result',
      tool_call_id: 'call-1',
      result: "Error: Unsupported tool 'lookup'.",
      is_error: true,
    },
  ]);
});

test('Agent streams output audio as stereo PCM and reuses the active stream', () => {
  const played = [];
  const audioPlayer = {
    off() {},
    on() {},
    play(resource) {
      played.push(resource);
    },
    stop() {},
  };
  const agent = new Agent(audioPlayer);

  agent.handleAudio({
    type: 'audio',
    audio_event: {
      event_id: 1,
      audio_base_64: pcm16(258, -258).toString('base64'),
    },
  });

  const firstStream = agent.pcmStream;
  assert.ok(firstStream);
  assert.equal(played.length, 1);
  assert.deepEqual(firstStream.read(), pcm16(258, 258, -258, -258));

  const writes = [];
  const originalWrite = firstStream.write.bind(firstStream);
  firstStream.write = (chunk, ...args) => {
    writes.push(Buffer.from(chunk));
    return originalWrite(chunk, ...args);
  };

  agent.handleAudio({
    type: 'audio',
    audio_event: {
      event_id: 2,
      audio_base_64: pcm16(1024).toString('base64'),
    },
  });

  assert.equal(agent.pcmStream, firstStream);
  assert.equal(played.length, 1);
  assert.deepEqual(writes, [pcm16(1024, 1024)]);
});
