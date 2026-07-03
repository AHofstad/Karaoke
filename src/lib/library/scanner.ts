import { convertFileSrc } from "@tauri-apps/api/core";
import { readDir, readFile } from "@tauri-apps/plugin-fs";
import { decodeSongText } from "../parser/encoding";
import { isUltraStarChart, parseUltraStar } from "../parser/ultrastar";
import { findFileCaseInsensitive } from "../playback/media";

export interface LibraryEntry {
  txtPath: string;
  dir: string;
  title: string;
  artist: string;
  coverUrl?: string;
  hasVideo: boolean;
  isDuet: boolean;
}

/**
 * Recursively scan a folder tree for UltraStar charts. Non-chart txt files
 * (song.ini folders, readmes) are skipped silently; parse failures never
 * abort the scan.
 */
export async function scanLibrary(rootDir: string): Promise<LibraryEntry[]> {
  const txtFiles: string[] = [];
  await collectTxtFiles(rootDir, txtFiles, 0);

  const entries: LibraryEntry[] = [];
  for (const txtPath of txtFiles) {
    try {
      const entry = await loadEntry(txtPath);
      if (entry) entries.push(entry);
    } catch {
      // unreadable file — skip
    }
  }

  entries.sort((a, b) => (a.artist + a.title).localeCompare(b.artist + b.title, undefined, { sensitivity: "base" }));
  return entries;
}

async function collectTxtFiles(dir: string, out: string[], depth: number): Promise<void> {
  if (depth > 8) return;
  let items;
  try {
    items = await readDir(dir);
  } catch {
    return;
  }
  for (const item of items) {
    const full = `${dir}\\${item.name}`;
    if (item.isDirectory) {
      await collectTxtFiles(full, out, depth + 1);
    } else if (item.isFile && item.name.toLowerCase().endsWith(".txt")) {
      out.push(full);
    }
  }
}

async function loadEntry(txtPath: string): Promise<LibraryEntry | null> {
  const { text } = decodeSongText(await readFile(txtPath));
  const song = parseUltraStar(text);
  if (!isUltraStarChart(song) || song.voices.length === 0) return null;

  const dir = txtPath.slice(0, Math.max(txtPath.lastIndexOf("\\"), txtPath.lastIndexOf("/")));
  let coverUrl: string | undefined;
  let hasVideo = false;
  try {
    const fileNames = (await readDir(dir)).filter((e) => e.isFile).map((e) => e.name);
    const cover = song.coverFile && findFileCaseInsensitive(fileNames, song.coverFile);
    if (cover) coverUrl = convertFileSrc(`${dir}\\${cover}`);
    hasVideo = !!(song.videoFile && findFileCaseInsensitive(fileNames, song.videoFile));
  } catch {
    // directory listing failed — entry still usable without cover
  }

  return {
    txtPath,
    dir,
    title: song.title || txtPath.split("\\").pop() || "?",
    artist: song.artist || "?",
    coverUrl,
    hasVideo,
    isDuet: song.isDuet,
  };
}

/** Case-, width- (CJK) and diacritic-insensitive search over artist + title. */
export function filterEntries(entries: LibraryEntry[], query: string): LibraryEntry[] {
  const q = normalize(query);
  if (!q) return entries;
  return entries.filter((e) => normalize(`${e.artist} ${e.title}`).includes(q));
}

function normalize(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}
