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

/** Total ms the media should play, honoring #END and the last note. */
export function songEndMs(song: ParsedSong): number | undefined {
  if (song.timing.endMs !== undefined) return song.timing.endMs;
  let last = 0;
  for (const voice of song.voices) {
    const phrase = voice.phrases[voice.phrases.length - 1];
    if (phrase) last = Math.max(last, msAtBeat(song.timing, phrase.endBeat));
  }
  return last > 0 ? last + 3000 : undefined; // small outro margin
}
