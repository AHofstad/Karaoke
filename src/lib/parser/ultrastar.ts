import type { Note, NoteType, ParsedSong, Phrase, SongTiming, Voice } from "./types";

const NOTE_TYPES: Record<string, NoteType> = {
  ":": "normal",
  "*": "golden",
  F: "freestyle",
  R: "rap",
  G: "rapGolden",
};

// <type> <startBeat> <length> <pitch> <text> — exactly one separator space
// before the text so that leading/trailing spaces in the lyric survive.
const NOTE_RE = /^([:*FRGfrg])\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)\s(.*)$/;
// "- 45" or "- 45 46" (second number is the relative-mode origin shift).
const BREAK_RE = /^-\s*(-?\d+)(?:\s+(-?\d+))?\s*$/;
// "P1", "P 2", ...
const PLAYER_RE = /^[Pp]\s*(\d+)\s*$/;
const HEADER_RE = /^#\s*([^:]+?)\s*:(.*)$/;

/**
 * Lenient UltraStar txt parser. Never throws on song content — anything
 * unexpected becomes a warning and the line is skipped. Relative mode is
 * resolved here; all beats in the result are absolute.
 */
export function parseUltraStar(raw: string): ParsedSong {
  const warnings: string[] = [];
  const headers = new Map<string, string>();
  const lines = raw.split(/\r?\n/);

  // Voice bookkeeping. Solo songs only ever touch voice 0.
  const voices: InternalVoice[] = [];
  let currentVoice = getVoice(voices, 0);
  let sawPlayerMarker = false;
  let relative = false;
  let relativeOrigin = 0;
  let ended = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (ended) break;
    if (line.trim() === "") continue;

    if (line.startsWith("#")) {
      const m = HEADER_RE.exec(line);
      if (!m) {
        warnings.push(`line ${i + 1}: malformed header ignored: ${line.trim()}`);
        continue;
      }
      const key = m[1].toUpperCase();
      const value = m[2].trim();
      if (headers.has(key)) {
        warnings.push(`line ${i + 1}: duplicate header #${key} ignored (first value kept)`);
        continue;
      }
      headers.set(key, value);
      if (key === "RELATIVE" && value.toUpperCase() === "YES") relative = true;
      continue;
    }

    const first = line[0];

    if (first === "E" && line.trim() === "E") {
      ended = true;
      continue;
    }

    const player = PLAYER_RE.exec(line);
    if (player) {
      sawPlayerMarker = true;
      const index = parseInt(player[1], 10) - 1;
      if (index < 0) {
        warnings.push(`line ${i + 1}: invalid player marker: ${line.trim()}`);
        continue;
      }
      currentVoice = getVoice(voices, index);
      // Relative origin restarts per voice in relative-mode duets.
      if (relative) relativeOrigin = 0;
      continue;
    }

    const note = NOTE_RE.exec(line);
    if (note) {
      const startBeat = parseInt(note[2], 10) + (relative ? relativeOrigin : 0);
      const lengthBeats = parseInt(note[3], 10);
      if (lengthBeats < 0) {
        warnings.push(`line ${i + 1}: negative note length, note skipped`);
        continue;
      }
      const typeChar = note[1].length === 1 ? note[1].toUpperCase() : note[1];
      currentVoice.notes.push({
        startBeat,
        lengthBeats,
        pitch: parseInt(note[4], 10),
        type: NOTE_TYPES[typeChar] ?? NOTE_TYPES[note[1]] ?? "normal",
        text: note[5],
      });
      continue;
    }

    const brk = BREAK_RE.exec(line);
    if (brk) {
      const beat = parseInt(brk[1], 10) + (relative ? relativeOrigin : 0);
      currentVoice.breaks.push(beat);
      if (brk[2] !== undefined) {
        if (relative) {
          relativeOrigin += parseInt(brk[2], 10);
        } else {
          warnings.push(`line ${i + 1}: second number on line break ignored (file is not #RELATIVE)`);
        }
      }
      continue;
    }

    warnings.push(`line ${i + 1}: unrecognized line ignored: ${truncate(line)}`);
  }

  const builtVoices: Voice[] = voices
    .filter((v) => v.notes.length > 0)
    .map((v, idx) => ({
      name: headers.get(`DUETSINGERP${v.index + 1}`) || headers.get(`P${v.index + 1}`) || undefined,
      phrases: buildPhrases(v.notes, v.breaks),
      index: v.index,
    }))
    .map(({ name, phrases }) => ({ name, phrases }));

  if (builtVoices.length === 0) warnings.push("no notes found");
  if (sawPlayerMarker && builtVoices.length < 2) {
    warnings.push("player markers present but only one voice has notes");
  }

  const timing = parseTiming(headers, warnings);
  const title = headers.get("TITLE") ?? "";
  const artist = headers.get("ARTIST") ?? "";
  if (!title) warnings.push("missing #TITLE");
  if (!artist) warnings.push("missing #ARTIST");

  return {
    headers,
    title,
    artist,
    audioFile: headers.get("AUDIO") || headers.get("MP3") || undefined,
    videoFile: headers.get("VIDEO") || headers.get("MP4") || undefined,
    coverFile: headers.get("COVER") || undefined,
    backgroundFile: headers.get("BACKGROUND") || undefined,
    timing,
    voices: builtVoices,
    isDuet: builtVoices.length > 1,
    warnings,
  };
}

/** True when the text looks like an UltraStar chart at all (vs song.ini, readme, ...). */
export function isUltraStarChart(parsed: ParsedSong): boolean {
  return (
    parsed.voices.length > 0 || parsed.headers.has("TITLE") || parsed.headers.has("ARTIST")
  );
}

/** Milliseconds into the audio at which a beat occurs. */
export function msAtBeat(timing: SongTiming, beat: number): number {
  return timing.gapMs + (beat * 60000) / (timing.bpm * 4);
}

/** Inverse of msAtBeat. */
export function beatAtMs(timing: SongTiming, ms: number): number {
  return ((ms - timing.gapMs) * timing.bpm * 4) / 60000;
}

interface InternalVoice {
  index: number;
  notes: Note[];
  breaks: number[];
}

function getVoice(voices: InternalVoice[], index: number): InternalVoice {
  let v = voices.find((x) => x.index === index);
  if (!v) {
    v = { index, notes: [], breaks: [] };
    voices.push(v);
    voices.sort((a, b) => a.index - b.index);
  }
  return v;
}

function buildPhrases(notes: Note[], breaks: number[]): Phrase[] {
  const sorted = [...notes].sort((a, b) => a.startBeat - b.startBeat);
  const sortedBreaks = [...breaks].sort((a, b) => a - b);
  const phrases: Phrase[] = [];
  let current: Note[] = [];
  let breakIdx = 0;

  for (const note of sorted) {
    while (breakIdx < sortedBreaks.length && note.startBeat >= sortedBreaks[breakIdx]) {
      pushPhrase(phrases, current);
      current = [];
      breakIdx++;
    }
    current.push(note);
  }
  pushPhrase(phrases, current);
  return phrases;
}

function pushPhrase(phrases: Phrase[], notes: Note[]): void {
  if (notes.length === 0) return;
  const last = notes[notes.length - 1];
  phrases.push({
    notes,
    startBeat: notes[0].startBeat,
    endBeat: last.startBeat + last.lengthBeats,
  });
}

/** Accepts both `123.45` and `123,45`; returns undefined for non-numbers. */
function parseLooseFloat(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = parseFloat(value.trim().replace(",", "."));
  return Number.isFinite(n) ? n : undefined;
}

function parseTiming(headers: Map<string, string>, warnings: string[]): SongTiming {
  const bpm = parseLooseFloat(headers.get("BPM"));
  if (bpm === undefined || bpm <= 0) warnings.push(`missing or invalid #BPM: ${headers.get("BPM") ?? "(absent)"}`);

  const gapMs = parseLooseFloat(headers.get("GAP")) ?? 0;

  // #VIDEOGAP is specified in ms but almost universally written in seconds
  // (corpus values like "23.5" or "-0,3"). Values that only make sense as ms
  // are converted.
  let videoGapSec = parseLooseFloat(headers.get("VIDEOGAP")) ?? 0;
  if (Math.abs(videoGapSec) > 1000) videoGapSec /= 1000;

  const startSec = parseLooseFloat(headers.get("START"));
  const endMs = parseLooseFloat(headers.get("END"));

  return {
    bpm: bpm !== undefined && bpm > 0 ? bpm : 120,
    gapMs,
    videoGapSec,
    startSec,
    endMs,
  };
}

function truncate(line: string): string {
  return line.length > 40 ? `${line.slice(0, 40)}…` : line;
}
