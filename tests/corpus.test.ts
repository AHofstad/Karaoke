import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { decodeSongText } from "../src/lib/parser/encoding";
import { isUltraStarChart, msAtBeat, parseUltraStar } from "../src/lib/parser/ultrastar";

const SONGS_DIR = join(import.meta.dirname, "..", "Research", "songs");

function findTxtFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...findTxtFiles(full));
    else if (entry.toLowerCase().endsWith(".txt")) out.push(full);
  }
  return out;
}

const txtFiles = findTxtFiles(SONGS_DIR);

describe("golden corpus", () => {
  it("finds the corpus", () => {
    expect(txtFiles.length).toBeGreaterThan(40);
  });

  it.each(txtFiles.map((f) => [relative(SONGS_DIR, f), f]))("parses %s", (_name, file) => {
    const { text } = decodeSongText(readFileSync(file));
    const song = parseUltraStar(text); // must never throw
    if (!isUltraStarChart(song)) return; // non-UltraStar files are allowed, they just classify as such

    expect(song.timing.bpm).toBeGreaterThan(0);
    expect(song.voices.length).toBeGreaterThan(0);
    for (const voice of song.voices) {
      expect(voice.phrases.length).toBeGreaterThan(0);
      for (const phrase of voice.phrases) {
        expect(phrase.notes.length).toBeGreaterThan(0);
        expect(phrase.endBeat).toBeGreaterThanOrEqual(phrase.startBeat);
      }
    }
    // Last note must land at a sane time (under 20 minutes).
    const lastVoice = song.voices[0];
    const lastPhrase = lastVoice.phrases[lastVoice.phrases.length - 1];
    expect(msAtBeat(song.timing, lastPhrase.endBeat)).toBeLessThan(20 * 60 * 1000);
  });

  it("summarizes every file (snapshot)", () => {
    const summary = txtFiles.map((file) => {
      const { text, encoding } = decodeSongText(readFileSync(file));
      const song = parseUltraStar(text);
      return {
        file: relative(SONGS_DIR, file).replace(/\\/g, "/"),
        chart: isUltraStarChart(song),
        title: song.title,
        artist: song.artist,
        bpm: song.timing.bpm,
        gapMs: song.timing.gapMs,
        encoding,
        voices: song.voices.length,
        phrases: song.voices.reduce((n, v) => n + v.phrases.length, 0),
        notes: song.voices.reduce((n, v) => n + v.phrases.reduce((m, p) => m + p.notes.length, 0), 0),
        warnings: song.warnings.length,
      };
    });
    expect(summary).toMatchSnapshot();
  });
});

describe("targeted real-file assertions", () => {
  const byName = (needle: string) => {
    const hit = txtFiles.find((f) => f.toLowerCase().includes(needle.toLowerCase()));
    if (!hit) throw new Error(`corpus file not found: ${needle}`);
    return parseUltraStar(decodeSongText(readFileSync(hit)).text);
  };

  it("Creed - My sacrifice: comma-decimal BPM", () => {
    const song = byName("My sacrifice");
    expect(song.timing.bpm).toBeCloseTo(293.26);
  });

  it("Matsumoto Bon Bon: #MP4 video alias and whitespace-damaged VIDEOGAP", () => {
    const song = byName("MatsumotoBonBon");
    expect(song.videoFile).toBe("MatsumotoBonBon.mp4");
    expect(song.timing.videoGapSec).toBeCloseTo(23.5);
    expect(song.coverFile).toBe("MatsumotoBonBon.jpg"); // from lowercase #Cover
  });

  it("Bling-Bang-Bang-Born: duet with singer names and webm audio", () => {
    const song = byName("Bling-Bang-Bang-Born");
    expect(song.isDuet).toBe(true);
    expect(song.voices).toHaveLength(2);
    expect(song.voices[0].name).toBe("Main vocals");
    expect(song.audioFile?.toLowerCase().endsWith(".webm")).toBe(true);
  });

  it("Filthy Frank notes-fixed: negative GAP survives", () => {
    const song = byName("notes-fixed");
    expect(song.timing.gapMs).toBe(-50);
    expect(song.headers.get("AUTHOR")).toBe("GuidoHansen");
  });

  it("double-number break lines without #RELATIVE parse as two phrases", () => {
    const song = byName("Motherland");
    expect(song.warnings.some((w) => w.includes("second number"))).toBe(true);
    expect(song.voices[0].phrases.length).toBeGreaterThan(1);
  });
});
