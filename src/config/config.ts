import 'dotenv/config';

function requireEnv(key: string): string {
  const value = process.env[key]?.trim();

  if (!value) {
    throw new Error(`Missing required environment variable: ${key}. Please check your .env file.`);
  }

  return value;
}

const ELEVENLABS_WS_BASE_URL = 'wss://api.elevenlabs.io/v1/convai/conversation';

export const DISCORD_CONFIG = {
  BOT_TOKEN: requireEnv('DISCORD_BOT_TOKEN'),
  CLIENT_ID: requireEnv('DISCORD_CLIENT_ID'),
} as const;

export const ELEVENLABS_CONFIG = {
  AGENT_WS_URL: `${ELEVENLABS_WS_BASE_URL}?agent_id=${requireEnv('AGENT_ID')}`,
} as const;
