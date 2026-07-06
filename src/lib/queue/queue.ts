import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { LibraryEntry } from "../library/scanner";

export interface RemoteSongWire {
  id: number;
  artist: string;
  title: string;
  isDuet: boolean;
  hasVideo: boolean;
  durationMs: number;
  creator?: string;
  tags?: string;
  coverPath?: string;
  txtPath: string;
}

export interface QueueItem {
  uid: number;
  song: {
    id: number;
    artist: string;
    title: string;
    isDuet: boolean;
    hasVideo: boolean;
    durationMs: number;
  };
  singer?: string | null;
}

export interface QueueSnapshot {
  nowPlaying: QueueItem | null;
  /** Time left in the playing song (desktop pushes this periodically). */
  remainingMs: number | null;
  queue: QueueItem[];
}

/**
 * Estimated wait until each queue item starts: remaining time of the current
 * song plus the durations of everything queued before it.
 */
export function queueEtas(queue: QueueItem[], remainingMs: number | null): number[] {
  const etas: number[] = [];
  let acc = remainingMs ?? 0;
  for (const item of queue) {
    etas.push(acc);
    acc += item.song.durationMs;
  }
  return etas;
}

export function formatEta(ms: number): string {
  const totalSec = Math.max(0, Math.round(ms / 1000));
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `+${min}:${String(sec).padStart(2, "0")}`;
}

export interface RemoteInfo {
  url: string | null;
  port: number;
}

/** Push the scanned library into the Rust remote server. Ids = array index. */
export async function publishLibrary(entries: LibraryEntry[]): Promise<void> {
  const songs: RemoteSongWire[] = entries.map((e, i) => ({
    id: i,
    artist: e.artist,
    title: e.title,
    isDuet: e.isDuet,
    hasVideo: e.hasVideo,
    durationMs: e.durationMs,
    creator: e.creator,
    tags: e.tags,
    coverPath: coverPathFromUrl(e),
    txtPath: e.txtPath,
  }));
  await invoke("set_library", { songs });
}

/** The scanner stores asset URLs; the server needs the raw file path. */
function coverPathFromUrl(e: LibraryEntry & { coverUrl?: string }): string | undefined {
  if (!e.coverUrl) return undefined;
  try {
    const url = new URL(e.coverUrl);
    return decodeURIComponent(url.pathname.replace(/^\//, ""));
  } catch {
    return undefined;
  }
}

export const getRemoteInfo = () => invoke<RemoteInfo>("get_remote_info");
export const getQueue = () => invoke<QueueSnapshot>("queue_snapshot");
export const addToQueue = (songId: number, singer?: string) =>
  invoke("queue_add_local", { songId, singer: singer ?? null });
export const removeFromQueue = (uid: number) => invoke("queue_remove", { uid });
export const moveInQueue = (uid: number, newIndex: number) =>
  invoke("queue_move", { uid, newIndex });
export const clearQueue = () => invoke("queue_clear");
export const nextInQueue = () =>
  invoke<{ item: QueueItem; txtPath: string } | null>("queue_next");
export const reportStopped = () => invoke("playing_stopped");
export const reportProgress = (remainingMs: number) =>
  invoke("set_progress", { remainingMs });

export function onQueueUpdated(cb: () => void): Promise<UnlistenFn> {
  return listen("queue-updated", cb);
}

/** Fires only when something is appended — the auto-start trigger. */
export function onQueueAdded(cb: () => void): Promise<UnlistenFn> {
  return listen("queue-added", cb);
}

export function onRemoteSkip(cb: () => void): Promise<UnlistenFn> {
  return listen("remote-skip", cb);
}
