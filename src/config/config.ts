import 'dotenv/config';

export function requireEnv(key: string): string {
  const value = process.env[key]?.trim();

  if (!value) {
    throw new Error(`Missing required environment variable: ${key}. Please check your .env file.`);
  }

  return value;
}

export function getAgentUrl(): string {
  return `wss://api.elevenlabs.io/v1/convai/conversation?agent_id=${requireEnv('AGENT_ID')}`;
}
