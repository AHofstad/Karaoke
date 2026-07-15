import { convertFileSrc } from "@tauri-apps/api/core";
import { readDir, readFile } from "@tauri-apps/plugin-fs";
import { decodeSongText } from "../parser/encoding";
import { sanitizeMp3 } from "./mp3";
import type { ParsedSong } from "../parser/types";
import { isUltraStarChart, parseUltraStar } from "../parser/ultrastar";
import { dirname, joinPath } from "../util/path";

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
    name ? findFileFuzzy(fileNames, name) : undefined;
  const toUrl = (actual: string | undefined): string | undefined =>
    actual ? convertFileSrc(joinPath(dir, actual)) : undefined;

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
  let bytes: Uint8Array = await readFile(joinPath(dir, fileName));
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "mp3") bytes = sanitizeMp3(bytes);
  const blob = new Blob([bytes as BlobPart], { type: MIME_BY_EXT[ext] ?? "application/octet-stream" });
  return URL.createObjectURL(blob);
}

const LINUX_CODEC_HINT =
  "On Linux, playback decoding comes from your system's GStreamer install, not the app. " +
  "Try: sudo apt install gstreamer1.0-plugins-good gstreamer1.0-plugins-bad gstreamer1.0-plugins-ugly gstreamer1.0-libav " +
  "(Debian/Ubuntu — see README for other distros), then restart the song.";

export function isLinux(): boolean {
  return typeof navigator !== "undefined" && /linux/i.test(navigator.userAgent) && !/android/i.test(navigator.userAgent);
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
  const base = `${names[err.code] ?? `code ${err.code}`}${err.message ? `: ${err.message}` : ""}`;
  const isCodecError = err.code === 3 || err.code === 4;
  return isCodecError && isLinux() ? `${base}\n${LINUX_CODEC_HINT}` : base;
}

/** Case-insensitive lookup of a referenced file among the directory's entries. */
export function findFileCaseInsensitive(fileNames: string[], wanted: string): string | undefined {
  const target = wanted.trim().toLowerCase();
  return fileNames.find((f) => f.toLowerCase() === target);
}

/**
 * Like findFileCaseInsensitive, but when the exact name is missing, accepts a
 * file with the same base name and a different extension (charts often say
 * .jpg while the file is .jpeg, etc.).
 */
export function findFileFuzzy(fileNames: string[], wanted: string): string | undefined {
  const exact = findFileCaseInsensitive(fileNames, wanted);
  if (exact) return exact;
  const base = stripExtension(wanted.trim().toLowerCase());
  if (!base) return undefined;
  return fileNames.find((f) => stripExtension(f.toLowerCase()) === base);
}

function stripExtension(name: string): string {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(0, i) : name;
}
