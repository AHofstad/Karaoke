import { describe, expect, it } from "vitest";
import { decodeSongText } from "../src/lib/parser/encoding";
import { beatAtMs, isUltraStarChart, msAtBeat, parseUltraStar } from "../src/lib/parser/ultrastar";

const MINIMAL = `#TITLE:Test Song
#ARTIST:Tester
#MP3:song.mp3
#BPM:300
#GAP:1000
: 0 4 5 Hel
: 4 4 5 lo
- 10
: 12 4 7  world
E
`;

describe("headers", () => {
  it("parses a minimal song", () => {
    const song = parseUltraStar(MINIMAL);
    expect(song.title).toBe("Test Song");
    expect(song.artist).toBe("Tester");
    expect(song.audioFile).toBe("song.mp3");
    expect(song.timing.bpm).toBe(300);
    expect(song.timing.gapMs).toBe(1000);
    expect(song.isDuet).toBe(false);
    expect(song.voices).toHaveLength(1);
    expect(song.voices[0].phrases).toHaveLength(2);
  });

  it("tolerates a missing #VERSION (none of the corpus has one)", () => {
    const song = parseUltraStar(MINIMAL);
    expect(song.headers.has("VERSION")).toBe(false);
    expect(song.voices.length).toBeGreaterThan(0);
  });

  it("accepts comma-decimal BPM", () => {
    const song = parseUltraStar("#TITLE:x\n#ARTIST:y\n#BPM:293,26\n: 0 1 0 a\nE");
    expect(song.timing.bpm).toBeCloseTo(293.26);
  });

  it("accepts dot-decimal BPM", () => {
    const song = parseUltraStar("#TITLE:x\n#ARTIST:y\n#BPM:400.5\n: 0 1 0 a\nE");
    expect(song.timing.bpm).toBeCloseTo(400.5);
  });

  it("accepts negative GAP", () => {
    const song = parseUltraStar("#TITLE:x\n#ARTIST:y\n#BPM:300\n#GAP:-50\n: 0 1 0 a\nE");
    expect(song.timing.gapMs).toBe(-50);
  });

  it("uppercases tag keys (#Cover)", () => {
    const song = parseUltraStar("#TITLE:x\n#ARTIST:y\n#BPM:300\n#Cover:pic.jpg\n: 0 1 0 a\nE");
    expect(song.coverFile).toBe("pic.jpg");
  });

  it("maps #MP4 to the video file when #VIDEO is absent", () => {
    const song = parseUltraStar("#TITLE:x\n#ARTIST:y\n#BPM:300\n#MP4:vid.mp4\n: 0 1 0 a\nE");
    expect(song.videoFile).toBe("vid.mp4");
  });

  it("prefers #VIDEO over #MP4", () => {
    const song = parseUltraStar(
      "#TITLE:x\n#ARTIST:y\n#BPM:300\n#VIDEO:real.mp4\n#MP4:other.mp4\n: 0 1 0 a\nE",
    );
    expect(song.videoFile).toBe("real.mp4");
  });

  it("trims header values with leading spaces and trailing tabs", () => {
    const song = parseUltraStar("#TITLE:x\n#ARTIST:y\n#BPM:300\n#VIDEOGAP: 23.5\t\n: 0 1 0 a\nE");
    expect(song.timing.videoGapSec).toBeCloseTo(23.5);
  });

  it("normalizes millisecond-scale VIDEOGAP to seconds", () => {
    const song = parseUltraStar("#TITLE:x\n#ARTIST:y\n#BPM:300\n#VIDEOGAP:2500\n: 0 1 0 a\nE");
    expect(song.timing.videoGapSec).toBeCloseTo(2.5);
  });

  it("keeps unknown tags and warns instead of rejecting", () => {
    const song = parseUltraStar("#TITLE:x\n#ARTIST:y\n#BPM:300\n#FOOBAR:baz\n: 0 1 0 a\nE");
    expect(song.headers.get("FOOBAR")).toBe("baz");
  });
});

describe("notes and phrases", () => {
  it("parses all five note types", () => {
    const song = parseUltraStar(
      "#TITLE:x\n#ARTIST:y\n#BPM:300\n: 0 1 0 a\n* 2 1 0 b\nF 4 1 0 c\nR 6 1 0 d\nG 8 1 0 e\nE",
    );
    const types = song.voices[0].phrases[0].notes.map((n) => n.type);
    expect(types).toEqual(["normal", "golden", "freestyle", "rap", "rapGolden"]);
  });

  it("accepts negative pitch", () => {
    const song = parseUltraStar("#TITLE:x\n#ARTIST:y\n#BPM:300\nF 0 8 -4 BLACK\nE");
    expect(song.voices[0].phrases[0].notes[0].pitch).toBe(-4);
  });

  it("preserves trailing spaces in lyric text", () => {
    const song = parseUltraStar("#TITLE:x\n#ARTIST:y\n#BPM:300\n: 0 2 5 la \nE");
    expect(song.voices[0].phrases[0].notes[0].text).toBe("la ");
  });

  it("preserves leading spaces in lyric text after the single separator", () => {
    const song = parseUltraStar("#TITLE:x\n#ARTIST:y\n#BPM:300\n: 0 2 5  world\nE");
    expect(song.voices[0].phrases[0].notes[0].text).toBe(" world");
  });

  it("ignores the second number of a break line in absolute mode, with a warning", () => {
    const song = parseUltraStar("#TITLE:x\n#ARTIST:y\n#BPM:300\n: 0 2 5 a\n- 45 46\n: 50 2 5 b\nE");
    expect(song.voices[0].phrases).toHaveLength(2);
    expect(song.voices[0].phrases[1].notes[0].startBeat).toBe(50);
    expect(song.warnings.some((w) => w.includes("second number"))).toBe(true);
  });

  it("handles LF and CRLF the same", () => {
    const lf = parseUltraStar("#TITLE:x\n#ARTIST:y\n#BPM:300\n: 0 1 0 a\nE\n");
    const crlf = parseUltraStar("#TITLE:x\r\n#ARTIST:y\r\n#BPM:300\r\n: 0 1 0 a\r\nE\r\n");
    expect(lf.voices[0].phrases).toEqual(crlf.voices[0].phrases);
  });

  it("ignores garbage after E", () => {
    const song = parseUltraStar("#TITLE:x\n#ARTIST:y\n#BPM:300\n: 0 1 0 a\nE\ntrailing junk\n");
    expect(song.warnings.every((w) => !w.includes("trailing junk"))).toBe(true);
  });
});

describe("relative mode", () => {
  it("converts relative beats to absolute", () => {
    const song = parseUltraStar(
      [
        "#TITLE:x",
        "#ARTIST:y",
        "#BPM:300",
        "#RELATIVE:YES",
        ": 0 2 5 a",
        ": 4 2 5 b",
        "- 8 10", // break at absolute 8, origin advances by 10
        ": 0 2 5 c", // absolute 10
        ": 4 2 5 d", // absolute 14
        "E",
      ].join("\n"),
    );
    const phrases = song.voices[0].phrases;
    expect(phrases).toHaveLength(2);
    expect(phrases[0].notes.map((n) => n.startBeat)).toEqual([0, 4]);
    expect(phrases[1].notes.map((n) => n.startBeat)).toEqual([10, 14]);
  });
});

describe("duets", () => {
  const DUET = [
    "#TITLE:x",
    "#ARTIST:y",
    "#BPM:300",
    "#DUETSINGERP1:Main vocals",
    "#DUETSINGERP2:Back vocals",
    "P1",
    ": 0 2 5 one",
    "P2",
    ": 10 2 5 two",
    "E",
  ].join("\n");

  it("splits voices on P markers and picks up singer names", () => {
    const song = parseUltraStar(DUET);
    expect(song.isDuet).toBe(true);
    expect(song.voices).toHaveLength(2);
    expect(song.voices[0].name).toBe("Main vocals");
    expect(song.voices[1].name).toBe("Back vocals");
    expect(song.voices[0].phrases[0].notes[0].text).toBe("one");
    expect(song.voices[1].phrases[0].notes[0].text).toBe("two");
  });

  it("tolerates 'P 1' spacing", () => {
    const song = parseUltraStar(DUET.replace("P1", "P 1").replace("P2", "P 2"));
    expect(song.voices).toHaveLength(2);
  });
});

describe("timing math", () => {
  it("computes msAtBeat per UltraStar quarter-beat semantics", () => {
    const timing = { bpm: 314, gapMs: 1985, videoGapSec: 0 };
    // 60000 / (314 * 4) = 47.7707... ms per beat
    expect(msAtBeat(timing, 0)).toBe(1985);
    expect(msAtBeat(timing, 32)).toBeCloseTo(1985 + (32 * 60000) / 1256, 6);
  });

  it("beatAtMs inverts msAtBeat", () => {
    const timing = { bpm: 293.26, gapMs: -50, videoGapSec: 0 };
    expect(beatAtMs(timing, msAtBeat(timing, 128))).toBeCloseTo(128, 6);
  });
});

describe("encoding", () => {
  it("strips a UTF-8 BOM", () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, 0x23, 0x54, 0x49, 0x54, 0x4c, 0x45, 0x3a, 0x78]); // BOM + "#TITLE:x"
    const { text, encoding } = decodeSongText(bytes);
    expect(encoding).toBe("utf-8");
    expect(text).toBe("#TITLE:x");
  });

  it("falls back to windows-1252 only on invalid UTF-8", () => {
    const bytes = new Uint8Array([0x23, 0x54, 0x49, 0x54, 0x4c, 0x45, 0x3a, 0xe9]); // "#TITLE:" + 0xE9 (é in cp1252, invalid UTF-8)
    const { text, encoding } = decodeSongText(bytes);
    expect(encoding).toBe("windows-1252");
    expect(text).toBe("#TITLE:é");
  });

  it("decodes valid UTF-8 with CJK", () => {
    const bytes = new TextEncoder().encode("#TITLE:オトノケ");
    const { text, encoding } = decodeSongText(bytes);
    expect(encoding).toBe("utf-8");
    expect(text).toBe("#TITLE:オトノケ");
  });
});

describe("non-UltraStar content", () => {
  it("classifies a song.ini as not a chart", () => {
    const song = parseUltraStar("[song]\nname = Roundabout\nartist = Yes\ndelay = 0\n");
    expect(isUltraStarChart(song)).toBe(false);
  });

  it("classifies a chart without headers but with notes as a chart", () => {
    const song = parseUltraStar(": 0 1 0 a\nE");
    expect(isUltraStarChart(song)).toBe(true);
  });
});
