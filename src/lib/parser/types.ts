/** Note types from the UltraStar format: `:` normal, `*` golden, `F` freestyle, `R` rap, `G` rap-golden. */
export type NoteType = "normal" | "golden" | "freestyle" | "rap" | "rapGolden";

export interface Note {
  startBeat: number;
  lengthBeats: number;
  /** Kept only for styling; scoring is out of scope. May be negative. */
  pitch: number;
  type: NoteType;
  /** Lyric fragment. Leading/trailing spaces are significant for display. */
  text: string;
}

export interface Phrase {
  notes: Note[];
  startBeat: number;
  endBeat: number;
}

export interface Voice {
  /** Display name from #DUETSINGERPn, if present. */
  name?: string;
  phrases: Phrase[];
}

export interface SongTiming {
  /** UltraStar BPM is quarter-beats: beat duration = 60000 / (bpm * 4) ms. */
  bpm: number;
  /** Offset of beat 0 from the start of the audio, in ms. May be negative. */
  gapMs: number;
  /** Video offset vs audio, in seconds. */
  videoGapSec: number;
  /** Skip into the audio at this many seconds when starting. */
  startSec?: number;
  /** Stop playback at this many ms of audio. */
  endMs?: number;
}

export interface ParsedSong {
  /** All header tags, keys uppercased, values trimmed. */
  headers: Map<string, string>;
  title: string;
  artist: string;
  /** File names as written in the txt (resolved against the song dir later). */
  audioFile?: string;
  videoFile?: string;
  coverFile?: string;
  backgroundFile?: string;
  timing: SongTiming;
  /** One entry for solo, two or more for duets. */
  voices: Voice[];
  isDuet: boolean;
  /** Recoverable oddities encountered while parsing. Parsing never throws on song content. */
  warnings: string[];
}
