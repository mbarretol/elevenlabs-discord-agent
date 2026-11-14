import test from 'node:test';
import assert from 'node:assert/strict';
import { monoPcm48kToStereo } from '../dist/utils/audioUtils.js';

function pcm16(...samples) {
  const buffer = Buffer.alloc(samples.length * 2);
  samples.forEach((sample, index) => buffer.writeInt16LE(sample, index * 2));
  return buffer;
}

test('monoPcm48kToStereo duplicates every sample into both channels', () => {
  const stereo = monoPcm48kToStereo(pcm16(258, -258).toString('base64'));

  assert.deepEqual(stereo, pcm16(258, 258, -258, -258));
});
