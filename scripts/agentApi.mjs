import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const agentConfigPath = resolve(
  import.meta.dirname,
  '..',
  'src',
  'config',
  'elevenlabs',
  'discord-agent.json'
);
const agentsUrl = 'https://api.elevenlabs.io/v1/convai/agents';

/**
 * Reads the bundled agent config.
 * @param language - Replaces the main language, `en`, for example `de` for a
 * German server. The agent can still switch to any language in `language_presets`.
 */
export async function readAgentConfig(language) {
  const config = JSON.parse(await readFile(agentConfigPath, 'utf8'));
  if (language) config.conversation_config.agent.language = language;
  return config;
}

function request(apiKey, method, url, config) {
  return fetch(url, {
    method,
    headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
}

/**
 * Creates the agent (no `agentId`) or updates an existing one, and returns the
 * response body.
 */
export async function sendAgentConfig(apiKey, config, agentId) {
  const [method, url] = agentId
    ? ['PATCH', `${agentsUrl}/${agentId}`]
    : ['POST', `${agentsUrl}/create`];
  let response = await request(apiKey, method, url, config);
  let body = await response.text();

  // Realtime models are rolling out gradually. Without access, the agent runs
  // its configured speech-to-text, LLM and text-to-speech models instead.
  if (!response.ok && body.includes('Realtime models are not available')) {
    console.log(
      'Realtime models are not available for this workspace yet. Using the standard models.'
    );
    config.conversation_config.realtime_model = null;
    response = await request(apiKey, method, url, config);
    body = await response.text();
  }

  if (!response.ok) {
    throw new Error(`ElevenLabs request failed (${response.status}): ${body}`);
  }
  return JSON.parse(body);
}
