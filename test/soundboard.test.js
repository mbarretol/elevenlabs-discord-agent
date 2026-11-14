import test from 'node:test';
import assert from 'node:assert/strict';
import { ChannelType } from 'discord.js';
import { createSoundboardTool } from '../dist/tools/soundboard.js';

function sound(id, name, available = true) {
  return { sound_id: id, name, available, guild_id: id.startsWith('g') ? 'guild-1' : undefined };
}

function createTool({
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

  return { played, play: createSoundboardTool(member, voiceChannel) };
}

test('soundboard plays the sound with the given name', async () => {
  const { played, play } = createTool({
    guildSounds: [sound('g1', 'Bruh')],
    defaultSounds: [sound('2', 'airhorn')],
  });

  assert.equal(await play({ name: ' AIRHORN ' }), "Played the 'airhorn' sound.");
  assert.equal(await play({ name: 'bruh' }), "Played the 'Bruh' sound.");
  assert.deepEqual(played, [
    { soundId: '2', guildId: undefined },
    { soundId: 'g1', guildId: 'guild-1' },
  ]);
});

test('soundboard prefers exact names, then server sounds, then partial matches', async () => {
  const { played, play } = createTool({
    guildSounds: [sound('g1', 'sad trombone'), sound('g2', 'horn')],
    defaultSounds: [sound('3', 'airhorn'), sound('4', 'trombone')],
  });

  await play({ name: 'horn' });
  await play({ name: 'trombone' });
  await play({ name: 'trom' });

  assert.deepEqual(
    played.map(options => options.soundId),
    ['g2', '4', 'g1']
  );
});

test('soundboard lists the available sounds when no name is given', async () => {
  const { played, play } = createTool({
    guildSounds: [sound('g1', 'bruh'), sound('g2', 'locked', false)],
    defaultSounds: [sound('3', 'airhorn')],
  });

  assert.deepEqual(JSON.parse(await play({})), { sounds: ['bruh', 'airhorn'] });
  assert.deepEqual(played, []);
});

test('soundboard reports the available sounds when the name is unknown', async () => {
  const { play } = createTool({ defaultSounds: [sound('1', 'airhorn'), sound('2', 'crickets')] });

  await assert.rejects(play({ name: 'drumroll' }), {
    message: "No soundboard sound named 'drumroll'. Available sounds: airhorn, crickets.",
  });
});

test('soundboard requires the member to be allowed to use it', async () => {
  const { play } = createTool({ defaultSounds: [sound('1', 'airhorn')], canUseSoundboard: false });

  await assert.rejects(play({ name: 'airhorn' }), /Marco is not allowed to use the soundboard/);
});

test('soundboard does not work in stage channels', async () => {
  const { play } = createTool({ type: ChannelType.GuildStageVoice });

  await assert.rejects(play({ name: 'airhorn' }), /not stage channels/);
});
