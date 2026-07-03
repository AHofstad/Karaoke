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
