import { resolve } from 'node:path';
import { config as loadEnv } from 'dotenv';
import { readAgentConfig, sendAgentConfig } from './agentApi.mjs';

// Applies src/config/elevenlabs/discord-agent.json to the agent in AGENT_ID.
// ElevenLabs merges the update into the agent's settings. Client tools were
// saved as separate tools when the agent was created, so they are left as they
// are; system tools such as end_call are updated.

loadEnv({ path: resolve(import.meta.dirname, '..', '.env'), quiet: true });
const { AGENT_ID: agentId, ELEVENLABS_API_KEY: apiKey, AGENT_LANGUAGE: language } = process.env;

async function main() {
  if (!agentId || !apiKey) {
    throw new Error('AGENT_ID and ELEVENLABS_API_KEY must be set in .env. Run npm run setup.');
  }

  const config = await readAgentConfig(language?.trim());
  const { tools = [], ...prompt } = config.conversation_config.agent.prompt;
  prompt.built_in_tools = Object.fromEntries(
    tools.filter(tool => tool.type === 'system').map(tool => [tool.name, tool])
  );
  config.conversation_config.agent.prompt = prompt;

  await sendAgentConfig(apiKey, config, agentId);
  console.log(`Updated ElevenLabs agent ${agentId}.`);
}

main().catch(error => {
  console.error(`Update failed: ${error.message}`);
  process.exitCode = 1;
});
