import ffmpeg from 'fluent-ffmpeg';
import { Readable } from 'stream';

/**
 * Utility class for audio processing operations.
 */
class AudioUtils {
  /**
   * Converts mono 44.1kHz PCM audio to stereo 48kHz PCM audio.
   *
   * @param inputBuffer - The input PCM audio buffer in mono 44.1kHz format (signed 16-bit little-endian)
   * @returns Promise resolving to a Buffer containing stereo 48kHz PCM audio (signed 16-bit little-endian)
   * @throws {Error} If FFmpeg processing fails
   *
   */
  static async mono441kHzToStereo48kHz(inputBuffer: Buffer): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];

      ffmpeg(Readable.from(inputBuffer))
        .inputFormat('s16le')
        .inputOptions(['-ar 44100', '-ac 1', '-f s16le'])
        .outputFormat('s16le')
        .outputOptions(['-ar 48000', '-ac 2', '-af aresample=async=1:first_pts=0', '-f s16le'])
        .on('error', err => reject(new Error(`FFmpeg error: ${err.message}`)))
        .pipe()
        .on('data', chunk => chunks.push(chunk))
        .on('end', () => resolve(Buffer.concat(chunks)));
    });
  }
}

export { AudioUtils };
