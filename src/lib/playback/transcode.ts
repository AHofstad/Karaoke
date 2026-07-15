import { convertFileSrc } from "@tauri-apps/api/core";
import { exists } from "@tauri-apps/plugin-fs";
import { Command } from "@tauri-apps/plugin-shell";
import { TARGET_LUFS, type Loudness } from "./gain";
import { parseLoudnormJson } from "./loudnorm";
import { joinPath } from "../util/path";

/**
 * Media the WebView cannot decode (MPEG Layer II posing as .mp3, avi/xvid
 * video, ...) is converted once with the bundled ffmpeg and cached next to
 * the original as "<name>.karaoke.mp3/.mp4".
 */

export async function transcodeAudioToMp3(dir: string, fileName: string): Promise<string> {
  const outPath = joinPath(dir, `${stripExt(fileName)}.karaoke.mp3`);
  if (!(await exists(outPath))) {
    await runFfmpeg([
      "-y",
      "-i", joinPath(dir, fileName),
      "-vn",
      "-codec:a", "libmp3lame",
      "-q:a", "2",
      outPath,
    ]);
  }
  return convertFileSrc(outPath);
}

export async function transcodeVideoToMp4(dir: string, fileName: string): Promise<string> {
  const outPath = joinPath(dir, `${stripExt(fileName)}.karaoke.mp4`);
  if (!(await exists(outPath))) {
    await runFfmpeg([
      "-y",
      "-i", joinPath(dir, fileName),
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-crf", "20",
      "-pix_fmt", "yuv420p",
      "-c:a", "aac",
      "-b:a", "192k",
      outPath,
    ]);
  }
  return convertFileSrc(outPath);
}

/** Measures integrated loudness (EBU R128) of a media file's audio track. */
export async function measureLoudness(filePath: string): Promise<Loudness> {
  const result = await runFfmpeg([
    "-hide_banner",
    "-nostats",
    "-i", filePath,
    "-map", "a:0",
    "-vn",
    "-af", `loudnorm=I=${TARGET_LUFS}:TP=-1.5:LRA=11:print_format=json`,
    "-f", "null",
    "-",
  ]);
  return parseLoudnormJson(result.stderr);
}

async function runFfmpeg(args: string[]): Promise<{ stderr: string }> {
  const result = await Command.sidecar("binaries/karaoke-ffmpeg", args).execute();
  if (result.code !== 0) {
    throw new Error(`ffmpeg exited with ${result.code}: ${result.stderr.slice(-500)}`);
  }
  return { stderr: result.stderr };
}

function stripExt(fileName: string): string {
  const i = fileName.lastIndexOf(".");
  return i > 0 ? fileName.slice(0, i) : fileName;
}
