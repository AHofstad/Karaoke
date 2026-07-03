import { describe, expect, it } from "vitest";
import { filterEntries, type LibraryEntry } from "../src/lib/library/scanner";

const entry = (artist: string, title: string): LibraryEntry => ({
  txtPath: `${artist}/${title}.txt`,
  dir: artist,
  title,
  artist,
  hasVideo: false,
  isDuet: false,
  durationMs: 180000,
});

const ENTRIES = [
  entry("Creepy Nuts", "オトノケ (Otonoke)"),
  entry("Creed", "Higher"),
  entry("Beyoncé", "Halo"),
  entry("BLACKPINK", "How You Like That"),
];

describe("filterEntries", () => {
  it("matches case-insensitively on artist and title", () => {
    expect(filterEntries(ENTRIES, "creed").map((e) => e.title)).toEqual(["Higher"]);
    expect(filterEntries(ENTRIES, "HIGHER")).toHaveLength(1);
  });

  it("matches CJK text", () => {
    expect(filterEntries(ENTRIES, "オトノケ")).toHaveLength(1);
  });

  it("is diacritic-insensitive", () => {
    expect(filterEntries(ENTRIES, "beyonce")).toHaveLength(1);
  });

  it("empty query returns all", () => {
    expect(filterEntries(ENTRIES, " ")).toHaveLength(4);
  });
});
