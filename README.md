# ElevenLabs Discord Agent

A Discord bot that enables natural, real-time voice interactions in your server using [ElevenLabs Agent WebSocket API](https://elevenlabs.io/docs/conversational-ai/docs/introduction) and the [Discord.js Voice API](https://discordjs.guide/voice/#installation), delivering engaging, voice-driven experiences.

## Features

- **Slash Command Support**: `/talk` starts a voice session and `/leave` disconnects the bot.
- **Real-time Conversations**: WebSocket input and output streaming for low latency voice conversations.
- **Interruption Handling**: The bot is able to handle interruptions gracefully.
- **Discord Message Search Tool**: The bundled ElevenLabs agent can search previous Discord messages by text, channel, or first/latest message.

## Getting Started

### Prerequisites

- Node.js (LTS recommended)

### Setup

1. **Clone the Repository**

   ```bash
   git clone https://github.com/mbarretol/elevenlabs-discord-voicebot
   cd elevenlabs-discord-voicebot
   ```

2. Install dependencies.

   ```bash
   npm install
   ```

3. Create your own Discord application at https://discord.com/developers/applications.

4. Go to the settings tab and click Bot.
   - Click "Reset Token" and keep the token for setup.
   - Disable "Public Bot" unless you want your bot to be visible by everyone.

5. Go to the OAuth2 tab and copy your "Client ID".

6. Create an ElevenLabs API key at https://elevenlabs.io/app/settings/api-keys.

7. Run the setup script and follow the prompts.

   ```bash
   npm run setup
   ```

   The setup script creates `.env`, creates a Discord-ready ElevenLabs agent from `src/config/elevenlabs/discord-agent.json`, saves the returned `AGENT_ID`, and prints a Discord invite URL. The bundled agent config includes the required audio settings and client tool schema for Discord message search.

8. Open the generated invite URL in your browser and invite the bot to your server.

9. Deploy the slash commands. Run this again whenever you add or change a command.

   ```bash
   npm run deploy
   ```

10. Run the bot.

```bash
npm start
```

11. Once started, your bot should appear online and you can use `/talk` for the bot to join the voice channel. Global slash command changes can take a few minutes to appear in Discord.

    **Note:** You must be in a voice channel for the bot to join.

## License

This project is licensed under the terms of the MIT license.
