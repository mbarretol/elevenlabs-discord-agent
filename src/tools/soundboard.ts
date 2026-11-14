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
 * Creates the `list_soundboard_sounds` and `play_soundboard_sound` client
 * tools. Their parameters are declared in `src/config/elevenlabs/discord-agent.json`.
 *
 * Sounds are played in the voice channel the bot joined, as the bot. The
 * server's own sounds take priority over Discord's default sounds.
 *
 * @param member - The member who started the voice session.
 * @param voiceChannel - The voice channel the bot joined.
 */
export function createSoundboardTools(
  member: GuildMember,
  voiceChannel: VoiceBasedChannel
): Record<'list_soundboard_sounds' | 'play_soundboard_sound', ClientTool> {
  const { rest } = member.client;

  const fetchSounds = async (): Promise<APISoundboardSound[]> => {
    const [guildSounds, defaultSounds] = await Promise.all([
      rest.get(
        Routes.guildSoundboardSounds(member.guild.id)
      ) as Promise<RESTGetAPIGuildSoundboardSoundsResult>,
      rest.get(
        Routes.soundboardDefaultSounds()
      ) as Promise<RESTGetAPISoundboardDefaultSoundsResult>,
    ]);
    return [...guildSounds.items, ...defaultSounds].filter(sound => sound.available);
  };

  return {
    list_soundboard_sounds: async () => {
      const sounds = await fetchSounds();
      return JSON.stringify({
        sounds: sounds.map(sound => ({ id: sound.sound_id, name: sound.name })),
      });
    },

    play_soundboard_sound: async params => {
      if (voiceChannel.type !== ChannelType.GuildVoice) {
        throw new Error('The soundboard only works in voice channels, not stage channels.');
      }
      if (!voiceChannel.permissionsFor(member).has(PermissionFlagsBits.UseSoundboard)) {
        throw new Error(`${member.displayName} is not allowed to use the soundboard here.`);
      }

      const query = typeof params.sound === 'string' ? params.sound.trim() : '';
      if (!query) throw new Error('No sound given.');

      const sound = findSound(await fetchSounds(), query);
      if (!sound) throw new Error(`No available soundboard sound '${query}'.`);

      await voiceChannel.sendSoundboardSound({ soundId: sound.sound_id, guildId: sound.guild_id });
      return JSON.stringify({ played: true, id: sound.sound_id, name: sound.name });
    },
  };
}

/** Matches by ID, then exact name, then partial name. */
function findSound(sounds: APISoundboardSound[], query: string): APISoundboardSound | undefined {
  const name = query.toLowerCase();
  return (
    sounds.find(sound => sound.sound_id === query) ??
    sounds.find(sound => sound.name.toLowerCase() === name) ??
    sounds.find(sound => sound.name.toLowerCase().includes(name))
  );
}
