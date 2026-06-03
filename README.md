# ElevenLabs Discord Agent

A Discord bot that enables natural, real-time voice interactions in your server using [ElevenLabs Agent WebSocket API](https://elevenlabs.io/docs/conversational-ai/docs/introduction) and the [Discord.js Voice API](https://discordjs.guide/voice/#installation), delivering engaging, voice-driven experiences.

## Features

- **Slash Command Support**: Simple `/talk` command interface to initiate voice interactions in any channel.
- **Real-time Conversations**: WebSocket input and output streaming for low latency voice conversations.
- **Interruption Handling**: The bot is able to handle interruptions gracefully.

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

   The setup script creates `.env`, creates a Discord-ready ElevenLabs agent, saves the returned `AGENT_ID`, and prints a Discord invite URL.

8. Open the generated invite URL in your browser and invite the bot to your server.

9. Run the bot.

   ```bash
   npm start
   ```

10. Once started, the slash commands will be deployed. This process might take a few minutes. Once everything is setup, your bot should appear online and you can use `/talk` for the bot to join the voice channel.
    **Note:** You must be in a voice channel for the bot to join.

### Manual Agent Setup

If you already have an ElevenLabs agent, run `npm run setup` and enter the existing `AGENT_ID` when prompted. The bot expects an agent that accepts 16kHz PCM input and returns 48kHz PCM output.

## License

This project is licensed under the terms of the MIT license.
