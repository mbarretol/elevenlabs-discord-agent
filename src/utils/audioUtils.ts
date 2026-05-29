/**
 * ElevenLabs must output 48 kHz 16-bit mono PCM.
 * Discord raw playback expects 48 kHz 16-bit stereo PCM.
 */
export function monoPcm48kToStereo(base64: string): Buffer {
  const mono = Buffer.from(base64, 'base64');
  const inView = new Int16Array(mono.buffer, mono.byteOffset, mono.byteLength / 2);
  const outView = new Int16Array(inView.length * 2);
  for (let i = 0, j = 0; i < inView.length; i++, j += 2) {
    const s = inView[i];
    outView[j] = s;
    outView[j + 1] = s;
  }
  return Buffer.from(outView.buffer, outView.byteOffset, outView.byteLength);
}
