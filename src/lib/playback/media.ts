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
  /** Actual on-disk file names (case-corrected), for fallback loading. */
  audioFileName?: string;
  videoFileName?: string;
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

  const resolveName = (name: string | undefined): string | undefined =>
    name ? findFileCaseInsensitive(fileNames, name) : undefined;
  const toUrl = (actual: string | undefined): string | undefined =>
    actual ? convertFileSrc(`${dir}\\${actual}`) : undefined;

  const audioFileName = resolveName(song.audioFile);
  const videoFileName = resolveName(song.videoFile);

  return {
    song,
    dir,
    txtPath,
    audioUrl: toUrl(audioFileName),
    videoUrl: toUrl(videoFileName),
    coverUrl: toUrl(resolveName(song.coverFile)),
    backgroundUrl: toUrl(resolveName(song.backgroundFile)),
    audioFileName,
    videoFileName,
  };
}

const MIME_BY_EXT: Record<string, string> = {
  mp3: "audio/mpeg",
  ogg: "audio/ogg",
  m4a: "audio/mp4",
  wav: "audio/wav",
  mp4: "video/mp4",
  webm: "video/webm",
};

/**
 * Fallback loader: read the file through the fs plugin and serve it as a blob
 * URL. Used when the asset protocol fails to stream a file. Caller must
 * revoke the URL when done.
 */
export async function loadFileAsBlobUrl(dir: string, fileName: string): Promise<string> {
  const bytes = await readFile(`${dir}\\${fileName}`);
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  const blob = new Blob([bytes], { type: MIME_BY_EXT[ext] ?? "application/octet-stream" });
  return URL.createObjectURL(blob);
}

/** Human-readable description of an HTMLMediaElement error. */
export function describeMediaError(el: HTMLMediaElement): string {
  const err = el.error;
  if (!err) return "unknown error";
  const names: Record<number, string> = {
    1: "MEDIA_ERR_ABORTED",
    2: "MEDIA_ERR_NETWORK",
    3: "MEDIA_ERR_DECODE",
    4: "MEDIA_ERR_SRC_NOT_SUPPORTED",
  };
  return `${names[err.code] ?? `code ${err.code}`}${err.message ? `: ${err.message}` : ""}`;
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
