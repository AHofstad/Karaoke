import { get } from "svelte/store";
import { beforeEach, describe, expect, it } from "vitest";
import type { Loudness } from "../src/lib/playback/gain";
import {
  getGainFor,
  initLoudness,
  loudnessProgress,
  prioritize,
  resetLoudness,
  setSinging,
} from "../src/lib/library/loudness";
import type { LibraryEntry } from "../src/lib/library/scanner";

function entry(txtPath: string, loudness?: Loudness): LibraryEntry {
  return { txtPath, dir: "d", title: "t", artist: "a", hasVideo: false, isDuet: false, durationMs: 1000, loudness };
}

/** Fake measurer whose promises resolve only when the test says so. */
function manualMeasure() {
  const started: string[] = [];
  const resolvers = new Map<string, (l: Loudness) => void>();
  const rejecters = new Map<string, (e: Error) => void>();
  const measure = (txtPath: string) =>
    new Promise<Loudness>((resolve, reject) => {
      started.push(txtPath);
      resolvers.set(txtPath, resolve);
      rejecters.set(txtPath, reject);
    });
  const finish = async (txtPath: string, lufs = -10) => {
    resolvers.get(txtPath)!({ lufs, tp: -1 });
    await Promise.resolve(); // let measureOne continue
    await Promise.resolve();
  };
  const fail = async (txtPath: string) => {
    rejecters.get(txtPath)!(new Error("boom"));
    await Promise.resolve();
    await Promise.resolve();
  };
  return { started, measure, finish, fail };
}

const noPersist = async () => {};

describe("loudness scheduler", () => {
  beforeEach(() => resetLoudness());

  it("measures in library order, one at a time", async () => {
    const m = manualMeasure();
    initLoudness([entry("a"), entry("b"), entry("c")], { measure: m.measure, persist: noPersist });
    expect(m.started).toEqual(["a"]); // concurrency 1
    await m.finish("a");
    expect(m.started).toEqual(["a", "b"]);
    await m.finish("b");
    await m.finish("c");
    expect(m.started).toEqual(["a", "b", "c"]);
  });

  it("skips songs with cached loudness and uses them for gain", () => {
    const m = manualMeasure();
    initLoudness([entry("a", { lufs: -12, tp: -1 }), entry("b")], { measure: m.measure, persist: noPersist });
    expect(m.started).toEqual(["b"]);
    expect(getGainFor("a")).toBeCloseTo(10 ** (-6 / 20), 4);
    expect(getGainFor("b")).toBe(1); // unmeasured
  });

  it("prioritize moves a song to the front of the line", async () => {
    const m = manualMeasure();
    initLoudness([entry("a"), entry("b"), entry("c"), entry("d")], { measure: m.measure, persist: noPersist });
    prioritize("d");
    await m.finish("a");
    expect(m.started).toEqual(["a", "d"]);
  });

  it("singing blocks new starts but lets the in-flight one finish", async () => {
    const m = manualMeasure();
    initLoudness([entry("a"), entry("b")], { measure: m.measure, persist: noPersist });
    setSinging(true);
    await m.finish("a"); // in-flight completes and is stored
    expect(getGainFor("a")).toBeLessThan(1);
    expect(m.started).toEqual(["a"]); // b not started
    setSinging(false);
    expect(m.started).toEqual(["a", "b"]); // resumed
    await m.finish("b");
  });

  it("failed songs are not retried on rescan", async () => {
    const m = manualMeasure();
    initLoudness([entry("a")], { measure: m.measure, persist: noPersist });
    await m.fail("a");
    initLoudness([entry("a")], { measure: m.measure, persist: noPersist });
    expect(m.started).toEqual(["a"]); // only the first attempt
    expect(getGainFor("a")).toBe(1);
  });

  it("reports progress including cached and failed songs", async () => {
    const m = manualMeasure();
    initLoudness([entry("a", { lufs: -14, tp: -1 }), entry("b"), entry("c")], { measure: m.measure, persist: noPersist });
    expect(get(loudnessProgress)).toEqual({ done: 1, total: 3 }); // a cached, b running
    await m.finish("b");
    expect(get(loudnessProgress)).toEqual({ done: 2, total: 3 });
    await m.fail("c");
    expect(get(loudnessProgress)).toEqual({ done: 3, total: 3 });
  });

  it("persists each successful measurement", async () => {
    const persisted: string[] = [];
    const m = manualMeasure();
    initLoudness([entry("a")], {
      measure: m.measure,
      persist: async (txtPath) => {
        persisted.push(txtPath);
      },
    });
    await m.finish("a");
    expect(persisted).toEqual(["a"]);
  });
});
