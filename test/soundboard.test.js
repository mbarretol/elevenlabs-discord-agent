import test from 'node:test';
import assert from 'node:assert/strict';
import { ChannelType } from 'discord.js';
import { createSoundboardTools } from '../dist/tools/soundboard.js';

function sound(id, name, available = true) {
  return { sound_id: id, name, available, guild_id: id.startsWith('g') ? 'guild-1' : undefined };
}

function createTools({
  guildSounds = [],
  defaultSounds = [],
  canUseSoundboard = true,
  type = ChannelType.GuildVoice,
} = {}) {
  const played = [];
  const routes = {
    '/guilds/guild-1/soundboard-sounds': { items: guildSounds },
    '/soundboard-default-sounds': defaultSounds,
  };
  const member = {
    displayName: 'Marco',
    guild: { id: 'guild-1' },
    client: { rest: { get: async route => routes[route] } },
  };
  const voiceChannel = {
    type,
    permissionsFor: () => ({ has: () => canUseSoundboard }),
    sendSoundboardSound: async options => played.push(options),
  };

  const tools = createSoundboardTools(member, voiceChannel);
  return {
    played,
    list: async () => JSON.parse(await tools.list_soundboard_sounds({})),
    play: async parameters => JSON.parse(await tools.play_soundboard_sound(parameters)),
  };
}

test('soundboard lists the available server and default sounds', async () => {
  const { list } = createTools({
    guildSounds: [sound('g1', 'bruh'), sound('g2', 'locked', false)],
    defaultSounds: [sound('3', 'airhorn')],
  });

  assert.deepEqual(await list(), {
    sounds: [
      { id: 'g1', name: 'bruh' },
      { id: '3', name: 'airhorn' },
    ],
  });
});

test('soundboard plays a sound by ID or name', async () => {
  const { played, play } = createTools({
    guildSounds: [sound('g1', 'Bruh')],
    defaultSounds: [sound('2', 'airhorn')],
  });

  assert.deepEqual(await play({ sound: 'g1' }), { played: true, id: 'g1', name: 'Bruh' });
  assert.deepEqual(await play({ sound: ' AIRHORN ' }), { played: true, id: '2', name: 'airhorn' });
  assert.deepEqual(played, [
    { soundId: 'g1', guildId: 'guild-1' },
    { soundId: '2', guildId: undefined },
  ]);
});

test('soundboard prefers exact names, then server sounds, then partial matches', async () => {
  const { played, play } = createTools({
    guildSounds: [sound('g1', 'sad trombone'), sound('g2', 'horn')],
    defaultSounds: [sound('3', 'airhorn'), sound('4', 'trombone')],
  });

  await play({ sound: 'horn' });
  await play({ sound: 'trombone' });
  await play({ sound: 'trom' });

  assert.deepEqual(
    played.map(options => options.soundId),
    ['g2', '4', 'g1']
  );
});

test('soundboard rejects missing and unknown sounds', async () => {
  const { played, play } = createTools({ defaultSounds: [sound('1', 'airhorn')] });

  await assert.rejects(play({}), /No sound given/);
  await assert.rejects(play({ sound: 'drumroll' }), /No available soundboard sound 'drumroll'/);
  assert.deepEqual(played, []);
});

test('soundboard requires the member to be allowed to use it', async () => {
  const { play } = createTools({ defaultSounds: [sound('1', 'airhorn')], canUseSoundboard: false });

  await assert.rejects(play({ sound: 'airhorn' }), /Marco is not allowed to use the soundboard/);
});

test('soundboard does not play in stage channels', async () => {
  const { play } = createTools({ type: ChannelType.GuildStageVoice });

  await assert.rejects(play({ sound: 'airhorn' }), /not stage channels/);
});
