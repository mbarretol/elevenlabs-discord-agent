import { existsSync } from 'node:fs';
import { copyFile, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline/promises';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');
const envPath = resolve(rootDir, '.env');
const envExamplePath = resolve(rootDir, 'env.example');
const agentConfigPath = resolve(rootDir, 'src', 'config', 'elevenlabs', 'discord-agent.json');
const createAgentUrl = 'https://api.elevenlabs.io/v1/convai/agents/create';
const discordVoicePermissions = 36_700_160;

function readArg(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
}

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function printHelp() {
  console.log(`Usage: npm run setup

Creates or updates .env, optionally creates an ElevenLabs agent, and prints a
Discord invite URL.

Options:
  --help                    Show this help message
  --yes                     Use existing values and defaults where possible
  --discord-token <token>   Discord bot token
  --discord-client-id <id>  Discord application client ID
  --elevenlabs-key <key>    ElevenLabs API key
  --agent-id <id>           Existing ElevenLabs agent ID`);
}

function parseEnv(contents) {
  const values = {};

  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex === -1) continue;

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    values[key] = value;
  }

  return values;
}

function upsertEnv(contents, updates) {
  const seen = new Set();
  const lines = contents.split(/\r?\n/).map(line => {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (!match) return line;

    const key = match[1];
    if (!(key in updates)) return line;

    seen.add(key);
    return `${key}=${updates[key]}`;
  });

  for (const [key, value] of Object.entries(updates)) {
    if (!seen.has(key)) {
      lines.push(`${key}=${value}`);
    }
  }

  return `${lines.filter((line, index, all) => line || index < all.length - 1).join('\n')}\n`;
}

async function ensureEnvFile() {
  if (existsSync(envPath)) return;

  if (existsSync(envExamplePath)) {
    await copyFile(envExamplePath, envPath);
    console.log('Created .env from env.example.');
    return;
  }

  await writeFile(envPath, '', 'utf8');
  console.log('Created .env.');
}

async function backupEnvFile() {
  if (!existsSync(envPath)) return;

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = resolve(rootDir, `.env.${timestamp}.backup`);
  await copyFile(envPath, backupPath);
  console.log(`Backed up existing .env to ${backupPath}`);
}

async function promptFor(
  rl,
  label,
  existingValue,
  fallbackValue,
  { required = true, sensitive = false } = {}
) {
  if (fallbackValue) return fallbackValue.trim();

  const suffix = existingValue ? ` [current: ${sensitive ? 'set' : existingValue}]` : '';
  const answer = await rl.question(`${label}${suffix}: `);
  const value = answer.trim() || existingValue;

  if (required && !value) {
    throw new Error(`${label} is required.`);
  }

  return value;
}

async function confirm(rl, message, defaultYes) {
  const hint = defaultYes ? 'Y/n' : 'y/N';
  const answer = (await rl.question(`${message} (${hint}): `)).trim().toLowerCase();
  if (!answer) return defaultYes;
  return answer === 'y' || answer === 'yes';
}

async function createAgent(apiKey) {
  const agentConfig = JSON.parse(await readFile(agentConfigPath, 'utf8'));

  console.log('Creating ElevenLabs agent...');
  const response = await fetch(createAgentUrl, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(agentConfig),
  });

  const responseText = await response.text();
  let responseBody;
  try {
    responseBody = responseText ? JSON.parse(responseText) : {};
  } catch {
    responseBody = { detail: responseText };
  }

  if (!response.ok) {
    const detail = responseBody.detail ?? responseBody.message ?? responseText;
    throw new Error(`ElevenLabs agent creation failed (${response.status}): ${detail}`);
  }

  if (!responseBody.agent_id) {
    throw new Error('ElevenLabs did not return an agent_id.');
  }

  console.log(`Created ElevenLabs agent: ${responseBody.agent_id}`);
  return responseBody.agent_id;
}

function createInviteUrl(clientId) {
  const params = new URLSearchParams({
    client_id: clientId,
    permissions: String(discordVoicePermissions),
    scope: 'bot applications.commands',
  });

  return `https://discord.com/oauth2/authorize?${params.toString()}`;
}

async function main() {
  if (hasFlag('--help')) {
    printHelp();
    return;
  }

  await ensureEnvFile();

  const envContents = await readFile(envPath, 'utf8');
  const env = parseEnv(envContents);
  const yes = hasFlag('--yes');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    const discordToken = await promptFor(
      rl,
      'Discord bot token',
      env.DISCORD_BOT_TOKEN,
      readArg('--discord-token'),
      { sensitive: true }
    );
    const discordClientId = await promptFor(
      rl,
      'Discord client ID',
      env.DISCORD_CLIENT_ID,
      readArg('--discord-client-id')
    );

    let agentId =
      readArg('--agent-id') ??
      env.AGENT_ID ??
      (yes ? '' : await rl.question('Existing ElevenLabs agent ID (leave blank to create one): '));
    agentId = agentId.trim();

    let elevenLabsApiKey = readArg('--elevenlabs-key') ?? env.ELEVENLABS_API_KEY ?? '';

    if (!agentId) {
      elevenLabsApiKey = await promptFor(rl, 'ElevenLabs API key', elevenLabsApiKey, undefined, {
        sensitive: true,
      });
      agentId = await createAgent(elevenLabsApiKey);
    } else if (!yes) {
      const shouldCreateAgent = await confirm(
        rl,
        'Create a new ElevenLabs agent from the bundled Discord config instead',
        false
      );

      if (shouldCreateAgent) {
        elevenLabsApiKey = await promptFor(rl, 'ElevenLabs API key', elevenLabsApiKey, undefined, {
          sensitive: true,
        });
        agentId = await createAgent(elevenLabsApiKey);
      }
    }

    const updates = {
      DISCORD_BOT_TOKEN: discordToken,
      DISCORD_CLIENT_ID: discordClientId,
      AGENT_ID: agentId,
    };

    if (elevenLabsApiKey) {
      updates.ELEVENLABS_API_KEY = elevenLabsApiKey;
    }

    await backupEnvFile();
    await writeFile(envPath, upsertEnv(envContents, updates), 'utf8');

    console.log('\nSetup complete.');
    console.log(`Invite URL: ${createInviteUrl(discordClientId)}`);
    console.log('\nNext step: npm start');
  } finally {
    rl.close();
  }
}

main().catch(error => {
  console.error(`Setup failed: ${error.message}`);
  process.exitCode = 1;
});
