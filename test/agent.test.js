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

test('Agent does not log raw conversation text unless explicitly enabled', () => {
  const agent = new Agent(createAudioPlayer());
  const originalInfo = logger.info;
  const messages = [];

  logger.info = (...args) => {
    messages.push(args.join(' '));
  };

  delete process.env.LOG_CONVERSATION_TEXT;

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

  assert.deepEqual(messages, ['Agent response received.', 'User transcript received.']);
});

test('Agent logs raw conversation text when LOG_CONVERSATION_TEXT is enabled', () => {
  const agent = new Agent(createAudioPlayer());
  const originalInfo = logger.info;
  const messages = [];

  logger.info = (...args) => {
    messages.push(args.join(' '));
  };

  process.env.LOG_CONVERSATION_TEXT = 'true';

  try {
    agent.handleAgentResponse({
      type: 'agent_response',
      agent_response_event: { agent_response: 'top secret answer' },
    });
  } finally {
    logger.info = originalInfo;
    delete process.env.LOG_CONVERSATION_TEXT;
  }

  assert.deepEqual(messages, ['Agent Response: top secret answer']);
});
