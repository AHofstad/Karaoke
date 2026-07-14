import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { appDataDir } from "@tauri-apps/api/path";
import {
  exists,
  mkdir,
  readDir,
  readFile,
  readTextFile,
  writeTextFile,
} from "@tauri-apps/plugin-fs";
import { writable } from "svelte/store";
import { decodeSongText } from "../parser/encoding";
import { isUltraStarChart, msAtBeat, parseUltraStar } from "../parser/ultrastar";
import type { Loudness } from "../playback/gain";
import { findFileFuzzy } from "../playback/media";
import { basename, dirname, joinPath } from "../util/path";

/** Progress of the new/changed-file parse pass of the current scan (cache hits don't count — they're near-instant). */
export const scanProgress = writable({ done: 0, total: 0 });

export interface LibraryEntry {
  txtPath: string;
  dir: string;
  title: string;
  artist: string;
  coverUrl?: string;
  hasVideo: boolean;
  isDuet: boolean;
  /** Estimated song length (last lyric + outro margin) for queue ETAs. */
  durationMs: number;
  /** Who timed the UltraStar version (#CREATOR / #AUTHOR). */
  creator?: string;
  /** Free-form labels from #TAGS / #GENRE, searchable. */
  tags?: string;
  /** Measured integrated loudness; missing until the background batch gets to it. */
  loudness?: Loudness;
}

interface TxtFileStat {
  path: string;
  mtimeMs: number;
  size: number;
}

/** What survives between sessions per chart; cover kept as a raw path. */
interface CachedSong {
  mtimeMs: number;
  size: number;
  /** null = parsed before but not an UltraStar chart; skip without re-reading. */
  entry: (Omit<LibraryEntry, "coverUrl"> & { coverPath?: string }) | null;
}

interface ScanCache {
  version: number;
  songs: Record<string, CachedSong>;
}

const CACHE_FILE = "scan-cache.json";
const CACHE_VERSION = 1;
const PARSE_CONCURRENCY = 16;

/**
 * Scan a folder tree for UltraStar charts. A single Rust call lists every
 * txt with mtime+size; only new or changed files are read and parsed, the
 * rest comes from the cache (7k-song libraries start in well under a second
 * after the first scan).
 */
export async function scanLibrary(rootDir: string): Promise<LibraryEntry[]> {
  const files = await invoke<TxtFileStat[]>("scan_txt_files", { root: rootDir });
  const cache = await loadCache();
  const nextSongs: Record<string, CachedSong> = {};
  const entries: LibraryEntry[] = [];

  const misses: TxtFileStat[] = [];
  for (const file of files) {
    const hit = cache.songs[file.path];
    if (hit && hit.mtimeMs === file.mtimeMs && hit.size === file.size) {
      nextSongs[file.path] = hit;
      if (hit.entry) entries.push(materialize(hit.entry));
    } else {
      misses.push(file);
    }
  }

  let scanned = 0;
  scanProgress.set({ done: 0, total: misses.length });
  await runPool(misses, PARSE_CONCURRENCY, async (file) => {
    let cached: CachedSong = { mtimeMs: file.mtimeMs, size: file.size, entry: null };
    try {
      cached.entry = await loadEntry(file.path);
    } catch {
      // unreadable file — cache the miss so it isn't retried every start
    }
    nextSongs[file.path] = cached;
    if (cached.entry) entries.push(materialize(cached.entry));
    scanned++;
    scanProgress.set({ done: scanned, total: misses.length });
  });

  await saveCache({ version: CACHE_VERSION, songs: nextSongs });

  // Measured LUFS values live in a Rust-owned loudness.json (see loudness.rs).
  try {
    const loudnessMap = await invoke<Record<string, Loudness>>("load_loudness");
    for (const e of entries) {
      const l = loudnessMap[e.txtPath];
      if (l) e.loudness = l;
    }
  } catch (e) {
    console.warn("could not load loudness store:", e);
  }

  const unique = dedupeEntries(entries);
  unique.sort((a, b) => (a.artist + a.title).localeCompare(b.artist + b.title, undefined, { sensitivity: "base" }));
  return unique;
}

function materialize(cached: NonNullable<CachedSong["entry"]>): LibraryEntry {
  const { coverPath, ...rest } = cached;
  return { ...rest, coverUrl: coverPath ? convertFileSrc(coverPath) : undefined };
}

async function runPool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      await worker(item);
    }
  });
  await Promise.all(lanes);
}

async function loadEntry(txtPath: string): Promise<CachedSong["entry"]> {
  const { text } = decodeSongText(await readFile(txtPath));
  const song = parseUltraStar(text);
  if (!isUltraStarChart(song) || song.voices.length === 0) return null;

  const dir = dirname(txtPath);
  let coverPath: string | undefined;
  let hasVideo = false;
  try {
    const fileNames = (await readDir(dir)).filter((e) => e.isFile).map((e) => e.name);
    const cover = pickCover(fileNames, song.coverFile, song.backgroundFile);
    if (cover) coverPath = joinPath(dir, cover);
    hasVideo = !!(song.videoFile && findFileFuzzy(fileNames, song.videoFile));
  } catch {
    // directory listing failed — entry still usable without cover
  }

  // Songs play to the end of the audio, which we don't know at scan time;
  // last lyric + a typical outro is a good ETA estimate.
  let lastLyricMs = 0;
  for (const voice of song.voices) {
    const last = voice.phrases[voice.phrases.length - 1];
    if (last) lastLyricMs = Math.max(lastLyricMs, msAtBeat(song.timing, last.endBeat));
  }

  return {
    txtPath,
    dir,
    title: song.title || basename(txtPath) || "?",
    artist: song.artist || "?",
    coverPath,
    hasVideo,
    isDuet: song.isDuet,
    durationMs: lastLyricMs + 15000,
    creator: song.headers.get("CREATOR") || song.headers.get("AUTHOR") || undefined,
    tags: [song.headers.get("TAGS"), song.headers.get("GENRE")].filter(Boolean).join(", ") || undefined,
  };
}

async function cachePath(): Promise<string> {
  return joinPath(await appDataDir(), CACHE_FILE);
}

async function loadCache(): Promise<ScanCache> {
  try {
    const path = await cachePath();
    if (await exists(path)) {
      const cache = JSON.parse(await readTextFile(path));
      if (cache.version === CACHE_VERSION && cache.songs) return cache;
    }
  } catch (e) {
    console.warn("scan cache unreadable, rebuilding:", e);
  }
  return { version: CACHE_VERSION, songs: {} };
}

async function saveCache(cache: ScanCache): Promise<void> {
  try {
    const dir = await appDataDir();
    if (!(await exists(dir))) await mkdir(dir, { recursive: true });
    await writeTextFile(await cachePath(), JSON.stringify(cache));
  } catch (e) {
    // cache is an optimization; scanning still works without it
    console.warn("could not save scan cache:", e);
  }
}

/**
 * Copies of the same chart in multiple folders (backup subfolders etc.) show
 * up once: same artist + title + song length counts as a duplicate.
 */
export function dedupeEntries(entries: LibraryEntry[]): LibraryEntry[] {
  const seen = new Set<string>();
  const out: LibraryEntry[] = [];
  for (const e of entries) {
    const key = `${e.artist} ${e.title} ${Math.round(e.durationMs / 1000)}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}

const IMAGE_EXTS = [".jpg", ".jpeg", ".png", ".webp", ".bmp"];

/**
 * Card image fallback chain: #COVER (fuzzy) → "[CO]"-tagged image →
 * #BACKGROUND (fuzzy) → any image in the folder.
 */
function pickCover(
  fileNames: string[],
  coverFile: string | undefined,
  backgroundFile: string | undefined,
): string | undefined {
  const isImage = (f: string) => IMAGE_EXTS.some((ext) => f.toLowerCase().endsWith(ext));
  return (
    (coverFile && findFileFuzzy(fileNames, coverFile)) ||
    fileNames.find((f) => isImage(f) && f.toUpperCase().includes("[CO]")) ||
    (backgroundFile && findFileFuzzy(fileNames, backgroundFile)) ||
    fileNames.find(isImage)
  );
}

/**
 * Case-, width- (CJK) and diacritic-insensitive search over artist, title,
 * creator and tags/genre.
 */
export function filterEntries(entries: LibraryEntry[], query: string): LibraryEntry[] {
  const q = normalize(query);
  if (!q) return entries;
  return entries.filter((e) =>
    normalize(`${e.artist} ${e.title} ${e.creator ?? ""} ${e.tags ?? ""}`).includes(q),
  );
}

function normalize(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}
