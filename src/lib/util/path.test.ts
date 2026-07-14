import { describe, expect, it } from "vitest";
import { basename, dirname, joinPath } from "./path";

describe("joinPath", () => {
  it("joins plain segments with /", () => {
    expect(joinPath("a", "b", "c")).toBe("a/b/c");
  });

  it("collapses a trailing separator on an earlier segment", () => {
    expect(joinPath("a/", "b")).toBe("a/b");
    expect(joinPath("a\\", "b")).toBe("a/b");
  });

  it("collapses a leading separator on a later segment", () => {
    expect(joinPath("a", "/b")).toBe("a/b");
    expect(joinPath("a", "\\b")).toBe("a/b");
  });

  it("preserves a Windows absolute-path first segment", () => {
    expect(joinPath("C:\\Users\\me\\songs", "song.mp3")).toBe("C:\\Users\\me\\songs/song.mp3");
  });

  it("drops empty segments", () => {
    expect(joinPath("a", "", "b")).toBe("a/b");
  });
});

describe("dirname", () => {
  it("handles forward-slash paths", () => {
    expect(dirname("/home/user/song.txt")).toBe("/home/user");
  });

  it("handles backslash paths", () => {
    expect(dirname("C:\\Users\\me\\song.txt")).toBe("C:\\Users\\me");
  });

  it("returns the input unchanged with no separator", () => {
    expect(dirname("song.txt")).toBe("song.txt");
  });
});

describe("basename", () => {
  it("handles forward-slash paths", () => {
    expect(basename("/home/user/song.txt")).toBe("song.txt");
  });

  it("handles backslash paths", () => {
    expect(basename("C:\\Users\\me\\song.txt")).toBe("song.txt");
  });

  it("returns the input unchanged with no separator", () => {
    expect(basename("song.txt")).toBe("song.txt");
  });
});
