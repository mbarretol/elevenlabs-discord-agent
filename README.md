# ElevenLabs Discord Agent

A Discord bot that enables natural, real-time voice interactions in your server using [ElevenLabs Agent WebSocket API](https://elevenlabs.io/docs/conversational-ai/docs/introduction) and the [Discord.js Voice API](https://discordjs.guide/voice/#installation), delivering engaging, voice-driven experiences.

## Features

- **Slash Command Support**: `/talk` starts a voice session and `/leave` disconnects the bot.
- **Real-time Conversations**: WebSocket input and output streaming for low latency voice conversations.
- **Interruption Handling**: The bot is able to handle interruptions gracefully.
- **Speaker Awareness**: The agent knows the server, the channel, who is in the call, and who is speaking, so it can address people by name in group conversations.
- **Group Etiquette**: The agent stays silent when people in the call talk to each other, leaves when asked to, and hangs up after 5 minutes without anyone speaking. Short reactions like "yeah", "genau" or "lol" do not interrupt it.
- **Discord Message Search Tool**: The bundled ElevenLabs agent can search previous Discord messages by text, channel, or first/latest message. Searches are limited to channels that the member who ran `/talk` can read.
- **Soundboard Tools**: The agent can list and play the server's soundboard sounds, or Discord's default ones, in the voice channel. Playing needs the member who ran `/talk` to have the Use Soundboard permission, and does not work in stage channels.

## Getting Started

### Prerequisites

- Node.js 22.12 or newer

### Setup

1. **Clone the Repository**

   ```bash
   git clone https://github.com/mbarretol/elevenlabs-discord-agent
   cd elevenlabs-discord-agent
   ```

2. Install dependencies.

   ```bash
   npm install
   ```

3. Create your own Discord application at https://discord.com/developers/applications.

4. Go to the settings tab and click Bot.
   - Click "Reset Token" and keep the token for setup.
   - Disable "Public Bot" unless you want your bot to be visible by everyone.
   - Enable "Message Content Intent". Discord restricts message search without it.

5. Go to the OAuth2 tab and copy your "Client ID".

6. Create an ElevenLabs API key at https://elevenlabs.io/app/settings/api-keys.

7. Run the setup script and follow the prompts.

   ```bash
   npm run setup
   ```

   The setup script creates `.env`, creates a Discord-ready ElevenLabs agent from `src/config/elevenlabs/discord-agent.json`, saves the returned `AGENT_ID`, and prints a Discord invite URL. The bundled agent config includes the required audio settings and client tool schemas for Discord message search and the soundboard.

   Running it again keeps the existing agent. Remove `AGENT_ID` from `.env` first to create a new one.

   The agent speaks English by default and switches to German when someone speaks it. To make another main language the default, set `AGENT_LANGUAGE` in `.env` (for example `de`) before running setup or `npm run update-agent`.

   To apply later changes to `discord-agent.json` to the existing agent, run `npm run update-agent`. It updates the prompt, settings and system tools; client tool definitions are left as they are.

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

## Latency

Each answer is logged with its latency:

```
Latency: agent audio 850 ms after end of speech (transcript: 310 ms, network round trip: 25 ms)
```

- **agent audio**: from the user's last voice packet to the first audio of the answer.
- **transcript**: when the final transcript of the user's turn arrived.
- **network round trip**: between the bot and ElevenLabs.

To keep it low:

- The bundled agent runs on [Eleven Realtime v1 Mini](https://elevenlabs.io/docs/eleven-agents/customization/realtime-models) (`realtime_model` in the agent config), ElevenLabs' lowest-latency model for voice conversation. Realtime models are rolling out gradually; workspaces without access get the configured LLM and text-to-speech models instead.
- Host the bot close to ElevenLabs. Its servers are in the USA, the Netherlands and Singapore.
- Set the voice channel's region override to the region nearest the bot, e.g. Rotterdam for a bot hosted in the Netherlands (voice channel settings, Region Override).
- `src/config/elevenlabs/discord-agent.json` only applies when `npm run setup` creates the agent. To apply changes to an existing agent, edit it in the ElevenLabs dashboard, or remove `AGENT_ID` from `.env` and run setup again.

## License

This project is licensed under the terms of the [MIT license](LICENSE).
