import 'dotenv/config';

function loadEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}. Please check your .env file.`);
  }
  return value;
}

export const DISCORD_CONFIG = {
  BOT_TOKEN: loadEnv('DISCORD_BOT_TOKEN'),
  CLIENT_ID: loadEnv('DISCORD_CLIENT_ID'),
};

export const ELEVENLABS_CONFIG = {
  AGENT_ID: loadEnv('AGENT_ID'),
  WS_BASE_URL: 'wss://api.elevenlabs.io/v1/convai/conversation',
};
