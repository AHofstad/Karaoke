import type { ParsedSong, Phrase, SongTiming, Voice } from "../parser/types";
import { msAtBeat } from "../parser/ultrastar";

/** Phrase timing resolved to milliseconds, for renderer consumption. */
export interface TimedPhrase {
  phrase: Phrase;
  startMs: number;
  endMs: number;
}

export function timePhrases(voice: Voice, timing: SongTiming): TimedPhrase[] {
  return voice.phrases.map((phrase) => ({
    phrase,
    startMs: msAtBeat(timing, phrase.startBeat),
    endMs: msAtBeat(timing, phrase.endBeat),
  }));
}

/**
 * Index of the phrase to display at `nowMs`: the active phrase, or the next
 * upcoming one. Returns phrases.length when the song is past the last phrase.
 */
export function displayPhraseIndex(phrases: TimedPhrase[], nowMs: number): number {
  for (let i = 0; i < phrases.length; i++) {
    if (nowMs <= phrases[i].endMs) return i;
  }
  return phrases.length;
}

/**
 * Explicit early-stop point (#END) in ms, if the chart defines one. Without
 * it the song plays to the natural end of the audio — outros keep playing
 * after the last lyric.
 */
export function songEndMs(song: ParsedSong): number | undefined {
  return song.timing.endMs;
}

export interface TimeRange {
  startMs: number;
  endMs: number;
}

/**
 * Long stretches with no lyrics in ANY voice (guitar solos etc.) — a duet is
 * only "instrumental" where both voices are silent. Doesn't report a gap
 * after the last phrase; that's the existing outro/skip-to-next-song path.
 */
export function findInstrumentalGaps(phrasesPerVoice: TimedPhrase[][], minGapMs = 15000): TimeRange[] {
  const intervals = phrasesPerVoice
    .flat()
    .map((p) => ({ startMs: p.startMs, endMs: p.endMs }))
    .sort((a, b) => a.startMs - b.startMs);
  if (intervals.length === 0) return [];

  const merged: TimeRange[] = [];
  for (const iv of intervals) {
    const last = merged[merged.length - 1];
    if (last && iv.startMs <= last.endMs) {
      last.endMs = Math.max(last.endMs, iv.endMs);
    } else {
      merged.push({ ...iv });
    }
  }

  const gaps: TimeRange[] = [];
  if (merged[0].startMs > minGapMs) {
    gaps.push({ startMs: 0, endMs: merged[0].startMs });
  }
  for (let i = 1; i < merged.length; i++) {
    if (merged[i].startMs - merged[i - 1].endMs > minGapMs) {
      gaps.push({ startMs: merged[i - 1].endMs, endMs: merged[i].startMs });
    }
  }
  return gaps;
}
