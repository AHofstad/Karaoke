import { convertFileSrc } from "@tauri-apps/api/core";
import { readDir, readFile } from "@tauri-apps/plugin-fs";
import { decodeSongText } from "../parser/encoding";
import type { ParsedSong } from "../parser/types";
import { isUltraStarChart, parseUltraStar } from "../parser/ultrastar";

export interface LoadedSong {
  song: ParsedSong;
  dir: string;
  txtPath: string;
  /** asset: URLs ready for <audio>/<video>/<img> src. */
  audioUrl?: string;
  videoUrl?: string;
  coverUrl?: string;
  backgroundUrl?: string;
}

/** Read, decode and parse a chart, and resolve its media files to asset URLs. */
export async function loadSong(txtPath: string): Promise<LoadedSong> {
  const bytes = await readFile(txtPath);
  const { text } = decodeSongText(bytes);
  const song = parseUltraStar(text);
  if (!isUltraStarChart(song)) {
    throw new Error(`${txtPath} is not an UltraStar chart`);
  }

  const dir = dirname(txtPath);
  const entries = await readDir(dir);
  const fileNames = entries.filter((e) => e.isFile).map((e) => e.name);

  const resolve = (name: string | undefined): string | undefined => {
    if (!name) return undefined;
    const actual = findFileCaseInsensitive(fileNames, name);
    return actual ? convertFileSrc(`${dir}\\${actual}`) : undefined;
  };

  return {
    song,
    dir,
    txtPath,
    audioUrl: resolve(song.audioFile),
    videoUrl: resolve(song.videoFile),
    coverUrl: resolve(song.coverFile),
    backgroundUrl: resolve(song.backgroundFile),
  };
}

/** Case-insensitive lookup of a referenced file among the directory's entries. */
export function findFileCaseInsensitive(fileNames: string[], wanted: string): string | undefined {
  const target = wanted.trim().toLowerCase();
  return fileNames.find((f) => f.toLowerCase() === target);
}

function dirname(path: string): string {
  const i = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
  return i >= 0 ? path.slice(0, i) : path;
}
