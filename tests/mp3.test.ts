import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { sanitizeMp3 } from "../src/lib/playback/mp3";

function id3Header(declaredSize: number): number[] {
  return [
    0x49, 0x44, 0x33, 0x03, 0x00, 0x00, // "ID3" v2.3
    (declaredSize >> 21) & 0x7f, (declaredSize >> 14) & 0x7f, (declaredSize >> 7) & 0x7f, declaredSize & 0x7f,
  ];
}

const VALID_FRAME_SYNC = [0xff, 0xfb, 0x90, 0x00]; // MPEG-1 Layer III, 128kbps, 44.1kHz

describe("sanitizeMp3", () => {
  it("passes bare mp3 (no ID3) through untouched", () => {
    const bytes = new Uint8Array([...VALID_FRAME_SYNC, 1, 2, 3]);
    expect(sanitizeMp3(bytes)).toBe(bytes);
  });

  it("cuts tag data that overflows the declared ID3 size", () => {
    // Declared size 4, but 100 bytes of text junk follow before the first frame.
    const junk = new Array(100).fill(0x41); // "AAAA..." — no frame sync
    const bytes = new Uint8Array([...id3Header(4), ...junk, ...VALID_FRAME_SYNC, 9, 9]);
    const out = sanitizeMp3(bytes);
    expect(out[0]).toBe(0xff);
    expect(out[1]).toBe(0xfb);
    expect(out.length).toBe(VALID_FRAME_SYNC.length + 2);
  });

  it("does not treat invalid sync patterns as frames", () => {
    // 0xFF followed by reserved version/layer bits must be skipped.
    const bytes = new Uint8Array([...id3Header(4), 0xff, 0xe9, 0x00, 0x00, ...VALID_FRAME_SYNC]);
    const out = sanitizeMp3(bytes);
    expect(out[1]).toBe(0xfb);
  });

  it("returns input unchanged when no frame sync exists", () => {
    const bytes = new Uint8Array([...id3Header(4), 1, 2, 3, 4, 5]);
    expect(sanitizeMp3(bytes)).toBe(bytes);
  });

  it("fixes the real Creed - Higher.mp3 (corrupt ReplayGain tag)", () => {
    const file = join(
      import.meta.dirname, "..", "Research", "songs", "Creed", "Creed - Higher", "Creed - Higher.mp3",
    );
    if (!existsSync(file)) return; // corpus is not part of the repo
    const out = sanitizeMp3(new Uint8Array(readFileSync(file)));
    // Known first real frame offset in this file.
    expect(out[0]).toBe(0xff);
    expect((out[1] & 0xe0) === 0xe0).toBe(true);
    expect(out.length).toBe(9247425 - 1332);
  });
});
