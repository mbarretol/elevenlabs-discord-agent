import 'dotenv/config';

function loadOptionalEnv(key: string): string | undefined {
  const value = process.env[key];
  if (!value) return undefined;

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function loadEnv(key: string): string {
  const value = loadOptionalEnv(key);
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}. Please check your .env file.`);
  }
  return value;
}

export const DISCORD_CONFIG = {
  BOT_TOKEN: loadEnv('DISCORD_BOT_TOKEN'),
  CLIENT_ID: loadEnv('DISCORD_CLIENT_ID'),
};

const TAVILY_KEY = loadOptionalEnv('TAVILY_API_KEY');

export const TAVILY_CONFIG = {
  TAVILY_KEY,
  MAX_RESULTS: 1,
  INCLUDE_ANSWER: true,
  INCLUDE_IMAGES: true,
  AUTO_PARAMETERS: true,
  SEARCH_DEPTH: "basic",
  ENABLED: Boolean(TAVILY_KEY),
} as const;

const ELEVENLABS_WS_BASE_URL = 'wss://api.elevenlabs.io/v1/convai/conversation';
const ELEVENLABS_AGENT_ID = loadEnv('AGENT_ID');

export const ELEVENLABS_CONFIG = {
  AGENT_WS_URL: `${ELEVENLABS_WS_BASE_URL}?agent_id=${ELEVENLABS_AGENT_ID}`,
} as const;
