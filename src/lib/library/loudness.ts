import { invoke } from "@tauri-apps/api/core";
import { writable } from "svelte/store";
import { computeGain, type Loudness } from "../playback/gain";
import { loadSong } from "../playback/media";
import { measureLoudness } from "../playback/transcode";
import type { LibraryEntry } from "./scanner";

/**
 * Background loudness measurement: after a scan, every song without a cached
 * LUFS value is measured with ffmpeg, one at a time. Queued songs jump to the
 * front; nothing new starts while a song is playing. Playback never waits on
 * this — unmeasured songs simply play at gain 1.
 *
 * Results are persisted through the Rust `save_loudness` command
 * (fire-and-forget: the write happens even if the invoke response is lost,
 * which can occur while the webview is busy right after startup).
 */

export const loudnessProgress = writable({ done: 0, total: 0 });

type MeasureFn = (txtPath: string) => Promise<Loudness>;
type PersistFn = (txtPath: string, loudness: Loudness) => Promise<void>;

interface Hooks {
  measure?: MeasureFn;
  persist?: PersistFn;
}

const CONCURRENCY = 1;

const measured = new Map<string, Loudness>();
const failed = new Set<string>(); // session-only: no retry loops on broken media
let pending: string[] = [];
let total = 0;
let singing = false;
let running = 0;
let measure: MeasureFn = defaultMeasure;
let persist: PersistFn = defaultPersist;

/** Seed from cached values and queue the rest for measurement, in library order. */
export function initLoudness(entries: LibraryEntry[], hooks?: Hooks): void {
  if (hooks?.measure) measure = hooks.measure;
  if (hooks?.persist) persist = hooks.persist;
  pending = [];
  for (const e of entries) {
    if (e.loudness) measured.set(e.txtPath, e.loudness);
    else if (!measured.has(e.txtPath) && !failed.has(e.txtPath)) pending.push(e.txtPath);
  }
  total = entries.length;
  publish();
  pump();
}

/** Synchronous; 1.0 while a song is still unmeasured. */
export function getGainFor(txtPath: string): number {
  return computeGain(measured.get(txtPath)?.lufs);
}

/** Move a queued song to the front of the measurement line. */
export function prioritize(txtPath: string): void {
  const i = pending.indexOf(txtPath);
  if (i > 0) {
    pending.splice(i, 1);
    pending.unshift(txtPath);
  }
  pump();
}

/** While singing, no new ffmpeg processes start (an in-flight one finishes). */
export function setSinging(active: boolean): void {
  singing = active;
  if (!active) pump();
}

function pump(): void {
  while (!singing && running < CONCURRENCY && pending.length > 0) {
    const txtPath = pending.shift()!;
    running++;
    void measureOne(txtPath);
  }
}

async function measureOne(txtPath: string): Promise<void> {
  try {
    const loudness = await measure(txtPath);
    measured.set(txtPath, loudness);
    persist(txtPath, loudness).catch((e) => console.warn("could not persist loudness:", e));
  } catch {
    failed.add(txtPath);
  }
  running--;
  publish();
  pump();
}

function publish(): void {
  loudnessProgress.set({ done: total - pending.length - running, total });
}

/** Test-only: clears all module state. */
export function resetLoudness(): void {
  measured.clear();
  failed.clear();
  pending = [];
  total = 0;
  singing = false;
  running = 0;
  measure = defaultMeasure;
  persist = defaultPersist;
  publish();
}

async function defaultMeasure(txtPath: string): Promise<Loudness> {
  // Reuses the chart parse + fuzzy media resolution; video-only songs get
  // their video's audio track measured (that's the element that plays).
  const loaded = await loadSong(txtPath);
  const fileName = loaded.audioFileName ?? loaded.videoFileName;
  if (!fileName) throw new Error("no media file");
  return measureLoudness(`${loaded.dir}\\${fileName}`);
}

function defaultPersist(txtPath: string, loudness: Loudness): Promise<void> {
  return invoke("save_loudness", { txtPath, lufs: loudness.lufs, tp: loudness.tp });
}
