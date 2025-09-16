# ElevenLabs Discord Agent

A Discord bot that enables natural, real-time voice interactions in your server using [ElevenLabs Agent WebSocket API](https://elevenlabs.io/docs/conversational-ai/docs/introduction) and the [Discord.js Voice API](https://discordjs.guide/voice/#installation), delivering engaging, voice-driven experiences.

## Features

- **Slash Command Support**: Simple `/talk` command interface to initiate voice interactions in any channel.
- **Real-time Conversations**: WebSocket input and output streaming for low latency voice conversations.
- **Interruption Handling**: The bot is able to handle interruptions gracefully.
- **Tool Calling**: Built-in support for ElevenLabs Agent tools. Configure `TAVILY_API_KEY` to enable Tavily-powered web search.

## Getting Started

### Prerequisites

- Node.js (LTS recommended)
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
   DISCORD_BOT_TOKEN = x
   DISCORD_CLIENT_ID = x
   AGENT_ID = x
   TAVILY_API_KEY = x   # optional, only needed for web_search tool
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

7. Go to https://elevenlabs.io/app/agents to set up your ElevenLabs Agent. Make sure to set the output format of the audio to 48kHz, copy the `AGENT_ID` and fill it in the .env file.

8. *(Optional)* Enable the Tavily-powered `web_search` tool for your ElevenLabs Agent.
   - Visit https://elevenlabs.io/app/agents/tools and create a new tool. Choose **Edit as JSON** and paste the following payload, then save:

     ```json
     {
       "type": "client",
       "name": "web_search",
       "description": "Searches the internet for real-time information, fact-checks claims, or answers specific questions outside of your internal knowledge.",
       "disable_interruptions": false,
       "force_pre_tool_speech": "auto",
       "assignments": [],
       "expects_response": true,
       "response_timeout_secs": 8,
       "parameters": [
         {
           "id": "query",
           "type": "string",
           "value_type": "llm_prompt",
           "description": "Analyze the user's spoken request, isolate the key question or search terms, and turn it into a concise query suitable for a search engine.",
           "dynamic_variable": "",
           "constant_value": "",
           "enum": null,
           "required": true
         }
       ],
       "dynamic_variables": {
         "dynamic_variable_placeholders": {}
       }
     }
     ```

   - In your agent configuration, update the system prompt to mention the new tool. For example:

     ```
     # Tools

     You have access to the following tools to help users effectively:

     **`web_search`**: Use this tool to look up real-time information on the internet, fact-check claims, or answer specific questions that fall outside your internal knowledge (e.g., news, specific facts, recipes).
     ```

   - Add the `web_search` entry under **Custom tools** for your agent so it can call the Tavily integration.

9. Install dependencies and run the bot.

   ```bash
   npm install
   npm start
   ```

10. Once started, the slash commands will be deployed. This process might take a few minutes. Once everything is setup, your bot should appear online and you can use `/talk` for the bot to join the voice channel.
   **Note:** You must be in a voice channel for the bot to join.

## License

This project is licensed under the terms of the MIT license.
