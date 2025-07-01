/**
 * Decode base-64 mono 48 kHz 16-bit PCM and return a stereo Buffer
 * compatible with `StreamType.Raw` (48 kHz 16-bit stereo).
 */
export function base64MonoPcmToStereo(base64: string): Buffer {
  const mono = Buffer.from(base64, 'base64');
  if (mono.byteLength === 0) return Buffer.alloc(0);

  const samples = mono.byteLength / 2;
  const stereo = Buffer.allocUnsafe(samples * 4);

  for (let i = 0; i < samples; i++) {
    const s = mono.readInt16LE(i * 2);
    stereo.writeInt16LE(s, i * 4);
    stereo.writeInt16LE(s, i * 4 + 2);
  }

  return stereo;
}
