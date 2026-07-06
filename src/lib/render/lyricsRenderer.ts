import type { SongTiming } from "../parser/types";
import type { TimedPhrase } from "../playback/clock";
import { displayPhraseIndex } from "../playback/clock";
import { msAtBeat } from "../parser/ultrastar";
import { layoutPhrase, lyricFont, type PhraseLayout } from "./layout";

export interface LaneColors {
  /** Unsung text. */
  base: string;
  /** Sung/filling text. */
  sung: string;
  outline: string;
}

export const SOLO_COLORS: LaneColors = {
  base: "#e8e8e8",
  sung: "#37b6ff",
  outline: "rgba(0,0,0,0.85)",
};

export const DUET_P2_COLORS: LaneColors = {
  base: "#e8e8e8",
  sung: "#ff7ab0",
  outline: "rgba(0,0,0,0.85)",
};

export interface LaneOptions {
  /** Vertical center of the current line, in px. */
  centerY: number;
  colors: LaneColors;
  baseFontSize: number;
}

const NEXT_LINE_SCALE = 0.6;
/** Upcoming text appears this long before it must be sung... */
const TEXT_LOOKAHEAD_MS = 10000;
/** Countdown shows only for silences longer than this... */
const COUNTDOWN_MIN_GAP_MS = 5000;
/** ...and only within this window before the next phrase (after the text). */
const COUNTDOWN_WINDOW_MS = 5000;

interface LayoutCacheEntry {
  phraseIndex: number;
  fontSize: number;
  layout: PhraseLayout;
}

/** Renders one voice's lyric lane; create one per voice per song. */
export class LyricsLane {
  private cache: LayoutCacheEntry | null = null;
  private nextCache: LayoutCacheEntry | null = null;

  constructor(
    private phrases: TimedPhrase[],
    private timing: SongTiming,
  ) {}

  render(ctx: CanvasRenderingContext2D, nowMs: number, width: number, opts: LaneOptions): void {
    const idx = displayPhraseIndex(this.phrases, nowMs);
    if (idx >= this.phrases.length) return;

    const maxWidth = width * 0.92;
    const current = this.phrases[idx];
    // During long instrumental sections the lane stays empty; text shows up
    // only 10 seconds ahead, the countdown dots 5 seconds ahead.
    if (nowMs < current.startMs - TEXT_LOOKAHEAD_MS) return;
    const layout = this.layoutFor(idx, ctx, maxWidth, opts.baseFontSize, false);

    this.drawPhrase(ctx, current, layout, nowMs, width, opts.centerY, opts.colors);

    const next = this.phrases[idx + 1];
    if (next) {
      const nextLayout = this.layoutFor(idx + 1, ctx, maxWidth, opts.baseFontSize * NEXT_LINE_SCALE, true);
      this.drawUpcoming(ctx, nextLayout, width, opts.centerY + opts.baseFontSize * 1.15, opts.colors);
    }

    // Countdown dots: only for long silences (> 5s since the previous phrase
    // or song start), and only in the final 5 seconds — one dot per second,
    // reaching zero exactly when singing starts.
    if (nowMs < current.startMs) {
      const prevEndMs = idx > 0 ? this.phrases[idx - 1].endMs : 0;
      const gapMs = current.startMs - prevEndMs;
      const remainingMs = current.startMs - nowMs;
      if (gapMs > COUNTDOWN_MIN_GAP_MS && remainingMs <= COUNTDOWN_WINDOW_MS) {
        this.drawCountdown(ctx, remainingMs, width, opts);
      }
    }
  }

  private layoutFor(
    phraseIndex: number,
    ctx: CanvasRenderingContext2D,
    maxWidth: number,
    fontSize: number,
    isNext: boolean,
  ): PhraseLayout {
    const slot = isNext ? this.nextCache : this.cache;
    if (slot && slot.phraseIndex === phraseIndex && slot.fontSize === fontSize) return slot.layout;
    const layout = layoutPhrase(ctx, this.phrases[phraseIndex].phrase, maxWidth, fontSize);
    const entry = { phraseIndex, fontSize, layout };
    if (isNext) this.nextCache = entry;
    else this.cache = entry;
    return layout;
  }

  private drawPhrase(
    ctx: CanvasRenderingContext2D,
    timed: TimedPhrase,
    layout: PhraseLayout,
    nowMs: number,
    width: number,
    centerY: number,
    colors: LaneColors,
  ): void {
    const left = (width - layout.totalWidth) / 2;
    ctx.textBaseline = "middle";

    for (const box of layout.boxes) {
      const note = box.note;
      const noteStart = msAtBeat(this.timing, note.startBeat);
      const noteEnd = msAtBeat(this.timing, note.startBeat + note.lengthBeats);
      const x = left + box.x;
      const active = nowMs >= noteStart && nowMs < noteEnd;
      const fontSize = active ? layout.fontSize * 1.035 : layout.fontSize;
      ctx.font = lyricFont(fontSize, note.type === "freestyle");

      // Base (unsung) text with outline for readability over video.
      ctx.lineWidth = Math.max(3, fontSize / 9);
      ctx.strokeStyle = colors.outline;
      ctx.strokeText(note.text, x, centerY);
      ctx.fillStyle = colors.base;
      ctx.fillText(note.text, x, centerY);

      // Sung overlay: full for finished notes, clipped fraction for the active one.
      let fillFraction = 0;
      if (nowMs >= noteEnd) fillFraction = 1;
      else if (active && noteEnd > noteStart) fillFraction = (nowMs - noteStart) / (noteEnd - noteStart);

      if (fillFraction > 0) {
        // Only the right edge of the clip is the fill boundary; pad the other
        // sides so glyph overhangs (j's left hook, descenders) aren't cut off.
        // Once fully sung the right edge stops being a boundary too — italic
        // and scaled glyphs overhang past the measured width.
        const pad = fontSize * 0.4;
        const rightPad = fillFraction >= 1 ? pad : 0;
        ctx.save();
        ctx.beginPath();
        ctx.rect(
          x - pad,
          centerY - fontSize * 1.3,
          pad + box.width * fillFraction + rightPad,
          fontSize * 2.6,
        );
        ctx.clip();
        ctx.fillStyle = colors.sung;
        ctx.fillText(note.text, x, centerY);
        ctx.restore();
      }
    }
  }

  private drawUpcoming(
    ctx: CanvasRenderingContext2D,
    layout: PhraseLayout,
    width: number,
    y: number,
    colors: LaneColors,
  ): void {
    const left = (width - layout.totalWidth) / 2;
    ctx.textBaseline = "middle";
    for (const box of layout.boxes) {
      ctx.font = lyricFont(layout.fontSize, box.note.type === "freestyle");
      ctx.lineWidth = Math.max(2, layout.fontSize / 10);
      ctx.strokeStyle = colors.outline;
      ctx.strokeText(box.note.text, left + box.x, y);
      ctx.fillStyle = "rgba(232,232,232,0.55)";
      ctx.fillText(box.note.text, left + box.x, y);
    }
  }

  private drawCountdown(
    ctx: CanvasRenderingContext2D,
    remainingMs: number,
    width: number,
    opts: LaneOptions,
  ): void {
    const total = COUNTDOWN_WINDOW_MS / 1000; // one dot per second
    const dots = Math.min(total, Math.ceil(remainingMs / 1000));
    if (dots <= 0) return;
    const r = 7;
    const gap = 26;
    const startX = width / 2 - ((total - 1) * gap) / 2;
    const y = opts.centerY - opts.baseFontSize * 1.4;
    for (let i = 0; i < dots; i++) {
      ctx.beginPath();
      ctx.arc(startX + i * gap, y, r, 0, Math.PI * 2);
      ctx.fillStyle = opts.colors.sung;
      ctx.fill();
    }
  }
}
