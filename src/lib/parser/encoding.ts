/**
 * Decode song file bytes to text.
 *
 * UTF-8 is tried first (strict). Only when the bytes are not valid UTF-8 do we
 * fall back to Windows-1252, which covers the Latin-1-era files in the wild.
 * A UTF-8 BOM is stripped if present.
 */
export function decodeSongText(bytes: Uint8Array): { text: string; encoding: "utf-8" | "windows-1252" } {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return { text: stripBom(text), encoding: "utf-8" };
  } catch {
    const text = new TextDecoder("windows-1252").decode(bytes);
    return { text: stripBom(text), encoding: "windows-1252" };
  }
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}
