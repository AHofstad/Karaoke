/**
 * Some mp3s in the wild have a corrupt ID3v2 size field (tag data overflows
 * the declared size, e.g. ReplayGain writers). Chromium's demuxer then finds
 * "no supported streams" while lenient players scan further. Cut everything
 * before the first plausible MPEG audio frame sync.
 */
export function sanitizeMp3(bytes: Uint8Array): Uint8Array {
  // Only rewrite when the file starts with an ID3v2 tag; bare mp3s pass through.
  if (bytes.length < 10 || bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) return bytes;
  // Frame header check reads bytes[i..i+2]; cap the scan at 2MB of leading junk.
  const limit = Math.min(bytes.length - 2, 2 * 1024 * 1024);
  for (let i = 10; i < limit; i++) {
    if (bytes[i] === 0xff && isMpegFrameHeader(bytes, i)) {
      return bytes.subarray(i);
    }
  }
  return bytes;
}

function isMpegFrameHeader(b: Uint8Array, i: number): boolean {
  if ((b[i + 1] & 0xe0) !== 0xe0) return false;
  const version = (b[i + 1] >> 3) & 0x03; // 01 = reserved
  const layer = (b[i + 1] >> 1) & 0x03; // 00 = reserved
  const bitrate = (b[i + 2] >> 4) & 0x0f; // 0000 = free, 1111 = invalid
  const sampleRate = (b[i + 2] >> 2) & 0x03; // 11 = reserved
  return version !== 1 && layer !== 0 && bitrate !== 0 && bitrate !== 0x0f && sampleRate !== 3;
}
