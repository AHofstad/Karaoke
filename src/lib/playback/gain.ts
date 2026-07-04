/**
 * Loudness normalization gain math.
 *
 * Playback gain is applied via HTMLMediaElement.volume, which can only
 * attenuate (<= 1.0). The target is therefore set low enough (-18 LUFS)
 * that virtually every track in a YouTube-rip library (~-14 LUFS after
 * YouTube's own normalization, louder for old masters) gets pulled down
 * to a common level; rarer quieter tracks simply play at 1.0.
 */

export const TARGET_LUFS = -18;

const MIN_GAIN = 0.05; // guards against corrupt cache data muting a song

export interface Loudness {
  lufs: number;
  tp: number; // true peak dBTP, cached for a future boost-capable upgrade
}

export function computeGain(lufs: number | undefined): number {
  if (lufs === undefined || !Number.isFinite(lufs)) return 1;
  const gainDb = TARGET_LUFS - lufs;
  const gain = 10 ** (gainDb / 20);
  return Math.min(1, Math.max(MIN_GAIN, gain));
}
