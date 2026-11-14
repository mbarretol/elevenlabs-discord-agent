import {
  type APISoundboardSound,
  ChannelType,
  type GuildMember,
  PermissionFlagsBits,
  type RESTGetAPIGuildSoundboardSoundsResult,
  type RESTGetAPISoundboardDefaultSoundsResult,
  Routes,
  type VoiceBasedChannel,
} from 'discord.js';
import type { ClientTool } from '../api/elevenlabs/agent.js';

/**
 * Creates the `play_soundboard_sound` client tool. Its parameters are
 * declared in `src/config/elevenlabs/discord-agent.json`.
 *
 * Sounds are played in the voice channel the bot joined, as the bot. The
 * server's own sounds take priority over Discord's default sounds.
 *
 * @param member - The member who started the voice session.
 * @param voiceChannel - The voice channel the bot joined.
 */
export function createSoundboardTool(
  member: GuildMember,
  voiceChannel: VoiceBasedChannel
): ClientTool {
  const { rest } = member.client;

  return async params => {
    if (voiceChannel.type !== ChannelType.GuildVoice) {
      throw new Error('The soundboard only works in voice channels, not stage channels.');
    }
    if (!voiceChannel.permissionsFor(member).has(PermissionFlagsBits.UseSoundboard)) {
      throw new Error(`${member.displayName} is not allowed to use the soundboard here.`);
    }

    const [guildSounds, defaultSounds] = await Promise.all([
      rest.get(
        Routes.guildSoundboardSounds(member.guild.id)
      ) as Promise<RESTGetAPIGuildSoundboardSoundsResult>,
      rest.get(
        Routes.soundboardDefaultSounds()
      ) as Promise<RESTGetAPISoundboardDefaultSoundsResult>,
    ]);
    const sounds = [...guildSounds.items, ...defaultSounds].filter(sound => sound.available);

    const name = typeof params.name === 'string' ? normalizeSoundName(params.name) : '';
    if (!name) return JSON.stringify({ sounds: sounds.map(sound => sound.name) });

    const sound = findSound(sounds, name);
    if (!sound) {
      throw new Error(
        `No soundboard sound named '${params.name}'. Available sounds: ${sounds
          .map(sound => sound.name)
          .join(', ')}.`
      );
    }

    await voiceChannel.sendSoundboardSound({ soundId: sound.sound_id, guildId: sound.guild_id });
    return `Played the '${sound.name}' sound.`;
  };
}

function findSound(sounds: APISoundboardSound[], name: string): APISoundboardSound | undefined {
  return (
    sounds.find(sound => normalizeSoundName(sound.name) === name) ??
    sounds.find(sound => normalizeSoundName(sound.name).includes(name))
  );
}

function normalizeSoundName(name: string): string {
  return name.trim().toLowerCase();
}
