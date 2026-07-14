/**
 * Cross-platform path helpers. Windows paths from Tauri's fs APIs use "\\",
 * Linux/macOS use "/" — these tolerate both on read and always join with "/"
 * (which Tauri's fs plugin, the asset protocol, and ffmpeg all accept on
 * every platform, Windows included).
 */

/** Joins path segments with "/", collapsing duplicate/edge separators. */
export function joinPath(...segments: string[]): string {
  return segments
    .filter((s) => s.length > 0)
    .map((s, i) => {
      const trimmed = s.replace(/[\\/]+$/, "");
      return i === 0 ? trimmed : trimmed.replace(/^[\\/]+/, "");
    })
    .join("/");
}

/** Directory portion of a path, tolerant of both "/" and "\" separators. */
export function dirname(path: string): string {
  const i = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
  return i >= 0 ? path.slice(0, i) : path;
}

/** Final path segment, tolerant of both "/" and "\" separators. */
export function basename(path: string): string {
  const i = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
  return i >= 0 ? path.slice(i + 1) : path;
}
