import type { Loudness } from "./gain";

/**
 * Parses the JSON block that ffmpeg's loudnorm filter prints to stderr
 * (print_format=json). The block is preceded by banner/progress noise and
 * its numeric values are strings, possibly "-inf" for silent tracks.
 */
export function parseLoudnormJson(stderr: string): Loudness {
  const start = stderr.lastIndexOf("{");
  const end = stderr.indexOf("}", start);
  if (start < 0 || end < 0) throw new Error("no loudnorm JSON in ffmpeg output");

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(stderr.slice(start, end + 1));
  } catch {
    throw new Error("malformed loudnorm JSON in ffmpeg output");
  }

  const lufs = Number(parsed.input_i);
  const tp = Number(parsed.input_tp);
  if (!Number.isFinite(lufs) || !Number.isFinite(tp)) {
    throw new Error(`unmeasurable loudness (input_i=${parsed.input_i})`);
  }
  return { lufs, tp };
}
