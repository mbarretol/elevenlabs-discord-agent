# ElevenLabs Discord Voicebot

A Discord bot that enables natural, real-time voice interactions in your server using [ElevenLabs' Conversational WebSocket API](https://elevenlabs.io/docs/conversational-ai/docs/introduction) and the [Discord.js Voice API](https://discordjs.guide/voice/#installation), delivering engaging, voice-driven experiences.

## Features

- **Slash Command Support**: Simple `/talk` command interface to initiate voice interactions in any channel.
- **Real-time Conversations**: WebSocket input and output streaming for low latency voice conversations.
- **Interruption Handling**: The bot is able to handle interruptions gracefully.

## Getting Started

### Prerequisites

- Latest LTS version of Node.js
- FFmpeg installed on your system
  - Windows: Install via [FFmpeg website](https://ffmpeg.org/download.html)
  - macOS: `brew install ffmpeg`
  - Linux: `sudo apt install ffmpeg`

### Setup

1. **Clone the Repository**

   ```bash
   git clone https://github.com/mbarretol/elevenlabs-discord-voicebot
   cd elevenlabs-discord-voicebot
   ```

2. Rename `.env.example` to `.env` and start filling in the values as detailed below:

   ```
   DISCORD_TOKEN = x
   DISCORD_CLIENT_ID = x

   AGENT_ID = x
   ```

3. Create your own Discord application at https://discord.com/developers/applications.

4. Go to the settings tab and click Bot.

   - Click "Reset Token" and fill in `DISCORD_BOT_TOKEN` in the .env file.
   - Disable "Public Bot" unless you want your bot to be visible by everyone.

5. Go to the OAuth2 tab, copy your "Client ID", and fill in `DISCORD_CLIENT_ID` in the .env file.

6. In the OAuth2 URL Generator Section, click on "bot" and set the following voice permissions:

   - Connect
   - Speak
   - Use Voice Activity

   Then copy the generated URL at the bottom, paste it into your browser, and follow the prompts to invite the bot to your server.

7. Go to https://elevenlabs.io/app/conversational-ai to set up your voice agent. Make sure to set the output format of the audio to 44.1kHz, copy the `AGENT_ID` and fill it in the .env file.

8. Install dependencies and run the bot.

   ```bash
   npm install
   npm start
   ```

9. Once started, the slash commands will be deployed; this process might take a few minutes. Once everything is setup, your bot should appear online and you can use `/talk` for the bot to join the voice channel.
   **Note:** You must be in a voice channel for the bot to join.

## License

This project is licensed under the terms of the MIT license.
