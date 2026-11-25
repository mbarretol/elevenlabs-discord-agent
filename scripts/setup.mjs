import { existsSync } from 'node:fs';
import { copyFile, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import readline from 'node:readline/promises';
import { PermissionFlagsBits } from 'discord.js';
import { parse } from 'dotenv';
import { readAgentConfig, sendAgentConfig } from './agentApi.mjs';

const rootDir = resolve(import.meta.dirname, '..');
const envPath = resolve(rootDir, '.env');
const envExamplePath = resolve(rootDir, 'env.example');
// Voice, plus what the message search and soundboard tools need.
const invitePermissions =
  PermissionFlagsBits.Connect |
  PermissionFlagsBits.Speak |
  PermissionFlagsBits.UseVAD |
  PermissionFlagsBits.UseSoundboard |
  PermissionFlagsBits.ViewChannel |
  PermissionFlagsBits.ReadMessageHistory;

function upsertEnv(contents, updates) {
  const remaining = { ...updates };
  const lines = contents
    .trimEnd()
    .split(/\r?\n/)
    .map(line => {
      const key = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=/)?.[1];
      if (!key || !(key in remaining)) return line;

      const value = remaining[key];
      delete remaining[key];
      return `${key}=${value}`;
    });

  for (const [key, value] of Object.entries(remaining)) {
    lines.push(`${key}=${value}`);
  }

  return `${lines.join('\n')}\n`;
}

async function promptFor(rl, label, existingValue, { sensitive = false } = {}) {
  const suffix = existingValue ? ` [current: ${sensitive ? 'set' : existingValue}]` : '';
  const answer = await rl.question(`${label}${suffix}: `);
  const value = answer.trim() || existingValue;

  if (!value) {
    throw new Error(`${label} is required.`);
  }

  return value;
}

async function createAgent(apiKey, language) {
  console.log('Creating ElevenLabs agent...');
  const { agent_id: agentId } = await sendAgentConfig(apiKey, await readAgentConfig(language));
  if (!agentId) {
    throw new Error('ElevenLabs did not return an agent_id.');
  }

  console.log(`Created ElevenLabs agent: ${agentId}`);
  return agentId;
}

function createInviteUrl(clientId) {
  const params = new URLSearchParams({
    client_id: clientId,
    permissions: String(invitePermissions),
    scope: 'bot applications.commands',
  });

  return `https://discord.com/oauth2/authorize?${params.toString()}`;
}

async function main() {
  if (!existsSync(envPath)) {
    await copyFile(envExamplePath, envPath);
    console.log('Created .env from env.example.');
  }

  const envContents = await readFile(envPath, 'utf8');
  const env = parse(envContents);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  try {
    const updates = {
      DISCORD_BOT_TOKEN: await promptFor(rl, 'Discord bot token', env.DISCORD_BOT_TOKEN, {
        sensitive: true,
      }),
      DISCORD_CLIENT_ID: await promptFor(rl, 'Discord client ID', env.DISCORD_CLIENT_ID),
    };

    if (env.AGENT_ID) {
      console.log(
        `Keeping ElevenLabs agent ${env.AGENT_ID}. Run npm run update-agent to apply ` +
          'src/config/elevenlabs/discord-agent.json to it, or remove AGENT_ID from .env to create a new one.'
      );
    } else {
      updates.ELEVENLABS_API_KEY = await promptFor(
        rl,
        'ElevenLabs API key',
        env.ELEVENLABS_API_KEY,
        {
          sensitive: true,
        }
      );
      updates.AGENT_ID = await createAgent(updates.ELEVENLABS_API_KEY, env.AGENT_LANGUAGE?.trim());
    }

    await writeFile(envPath, upsertEnv(envContents, updates), 'utf8');

    console.log('\nSetup complete.');
    console.log(`Invite URL: ${createInviteUrl(updates.DISCORD_CLIENT_ID)}`);
    console.log('\nNext steps: npm run deploy, then npm start');
  } finally {
    rl.close();
  }
}

main().catch(error => {
  console.error(`Setup failed: ${error.message}`);
  process.exitCode = 1;
});
