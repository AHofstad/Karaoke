import { describe, expect, it } from "vitest";
import { findInstrumentalGaps, type TimedPhrase } from "../src/lib/playback/clock";
import type { Phrase } from "../src/lib/parser/types";

function tp(startMs: number, endMs: number): TimedPhrase {
  return { phrase: {} as Phrase, startMs, endMs };
}

describe("findInstrumentalGaps", () => {
  it("reports a solo gap longer than the threshold", () => {
    const voice = [tp(0, 5000), tp(25000, 30000)];
    const gaps = findInstrumentalGaps([voice], 15000);
    expect(gaps).toEqual([{ startMs: 5000, endMs: 25000 }]);
  });

  it("ignores gaps at or under the threshold", () => {
    const voice = [tp(0, 5000), tp(15000, 20000)];
    expect(findInstrumentalGaps([voice], 15000)).toEqual([]);
  });

  it("duet: a gap only counts where BOTH voices are silent", () => {
    const p1 = [tp(0, 5000), tp(30000, 35000)];
    // p2 sings right through p1's long gap.
    const p2 = [tp(10000, 15000)];
    expect(findInstrumentalGaps([p1, p2], 15000)).toEqual([]);
  });

  it("duet: reports the gap where both voices are silent", () => {
    const p1 = [tp(0, 5000), tp(30000, 35000)];
    const p2 = [tp(0, 4000)];
    const gaps = findInstrumentalGaps([p1, p2], 15000);
    expect(gaps).toEqual([{ startMs: 5000, endMs: 30000 }]);
  });

  it("reports a long intro before the first phrase", () => {
    const voice = [tp(20000, 25000)];
    expect(findInstrumentalGaps([voice], 15000)).toEqual([{ startMs: 0, endMs: 20000 }]);
  });

  it("does not report a trailing gap after the last phrase", () => {
    const voice = [tp(0, 5000)];
    expect(findInstrumentalGaps([voice], 15000)).toEqual([]);
  });
});
