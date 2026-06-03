# AGENTS.md

## Commands

- Install dependencies: `npm install`
- Build: `npm run build`
- Test: `npm test`
- Lint: `npm run lint`
- Format check: `npm run format`
- Format fix: `npm run format:fix`
- Start bot: `npm start`

## Project Layout

- Discord client entrypoint: `src/api/discord/client.ts`
- Discord voice/speech handling: `src/api/discord/speech.ts`
- ElevenLabs WebSocket agent: `src/api/elevenlabs/agent.ts`
- Slash commands: `src/commands`
- Config and logging: `src/config`
- Shared helpers: `src/utils`
- Tests: `test`

## Conventions

- This is a TypeScript ESM project, keep imports using `.js` extensions for local modules.
- Keep code simple, concise, and clean, avoid overengineering.
- Do not add overly defensive safety checks unless they protect a real failure mode.
- Use `Embeds` from `src/utils/embedHelper.ts` for Discord embed responses.
- Keep command handlers small and follow the existing pattern in `src/commands/talk.ts` and `src/commands/leave.ts`.
- Do not commit `.env` or credentials.
- Do not edit generated `dist` output directly.

## Verification

- For code changes, run at least `npm run build`.
- Run `npm test` when behavior changes.
- Run `npm run lint` and `npm run format` before larger cleanups.
