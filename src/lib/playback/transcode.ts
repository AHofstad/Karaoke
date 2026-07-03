import { convertFileSrc } from "@tauri-apps/api/core";
import { exists } from "@tauri-apps/plugin-fs";
import { Command } from "@tauri-apps/plugin-shell";

/**
 * Media the WebView cannot decode (MPEG Layer II posing as .mp3, avi/xvid
 * video, ...) is converted once with the bundled ffmpeg and cached next to
 * the original as "<name>.karaoke.mp3/.mp4".
 */

export async function transcodeAudioToMp3(dir: string, fileName: string): Promise<string> {
  const outPath = `${dir}\\${stripExt(fileName)}.karaoke.mp3`;
  if (!(await exists(outPath))) {
    await runFfmpeg([
      "-y",
      "-i", `${dir}\\${fileName}`,
      "-vn",
      "-codec:a", "libmp3lame",
      "-q:a", "2",
      outPath,
    ]);
  }
  return convertFileSrc(outPath);
}

export async function transcodeVideoToMp4(dir: string, fileName: string): Promise<string> {
  const outPath = `${dir}\\${stripExt(fileName)}.karaoke.mp4`;
  if (!(await exists(outPath))) {
    await runFfmpeg([
      "-y",
      "-i", `${dir}\\${fileName}`,
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

async function runFfmpeg(args: string[]): Promise<void> {
  const result = await Command.sidecar("binaries/ffmpeg", args).execute();
  if (result.code !== 0) {
    throw new Error(`ffmpeg exited with ${result.code}: ${result.stderr.slice(-500)}`);
  }
}

function stripExt(fileName: string): string {
  const i = fileName.lastIndexOf(".");
  return i > 0 ? fileName.slice(0, i) : fileName;
}
