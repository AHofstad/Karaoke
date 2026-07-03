import type { Note, Phrase } from "../parser/types";

export interface SyllableBox {
  note: Note;
  /** X offset from the left edge of the phrase, in px. */
  x: number;
  width: number;
}

export interface PhraseLayout {
  boxes: SyllableBox[];
  totalWidth: number;
  fontSize: number;
}

export const LYRIC_FONT_FAMILY =
  '"Segoe UI", "Yu Gothic UI", "Meiryo", system-ui, sans-serif';

export function lyricFont(fontSize: number, italic = false): string {
  return `${italic ? "italic " : ""}600 ${fontSize}px ${LYRIC_FONT_FAMILY}`;
}

/**
 * Measure syllable boxes for one phrase. Starts at `baseFontSize` and shrinks
 * until the phrase fits `maxWidth`.
 */
export function layoutPhrase(
  ctx: CanvasRenderingContext2D,
  phrase: Phrase,
  maxWidth: number,
  baseFontSize: number,
): PhraseLayout {
  let fontSize = baseFontSize;
  for (;;) {
    const boxes = measure(ctx, phrase.notes, fontSize);
    const totalWidth = boxes.length ? boxes[boxes.length - 1].x + boxes[boxes.length - 1].width : 0;
    if (totalWidth <= maxWidth || fontSize <= 12) {
      return { boxes, totalWidth, fontSize };
    }
    fontSize = Math.floor(fontSize * 0.9);
  }
}

function measure(ctx: CanvasRenderingContext2D, notes: Note[], fontSize: number): SyllableBox[] {
  const boxes: SyllableBox[] = [];
  // Small gap between syllables so each one reads as its own unit — helps a
  // lot when singing unfamiliar languages (Japanese romaji, etc.).
  const syllableGap = fontSize * 0.14;
  let x = 0;
  for (const note of notes) {
    ctx.font = lyricFont(fontSize, note.type === "freestyle");
    const width = ctx.measureText(note.text).width;
    boxes.push({ note, x, width });
    x += width + syllableGap;
  }
  return boxes;
}
