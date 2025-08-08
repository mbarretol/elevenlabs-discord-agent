/**
 * Decode base-64 mono 48 kHz 16-bit PCM and return a stereo Buffer
 * compatible with `StreamType.Raw` (48 kHz 16-bit stereo).
 */
export function base64MonoPcmToStereo(base64: string): Buffer {
  const mono = Buffer.from(base64, 'base64');
  if (mono.byteLength === 0) return Buffer.alloc(0);

  const inView = new Int16Array(mono.buffer, mono.byteOffset, mono.byteLength / 2);
  const outView = new Int16Array(inView.length * 2);
  for (let i = 0, j = 0; i < inView.length; i++, j += 2) {
    const s = inView[i];
    outView[j] = s;
    outView[j + 1] = s;
  }
  return Buffer.from(outView.buffer, outView.byteOffset, outView.byteLength);
}
