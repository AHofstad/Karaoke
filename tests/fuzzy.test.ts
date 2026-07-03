import { describe, expect, it } from "vitest";
import { findFileFuzzy } from "../src/lib/playback/media";

describe("findFileFuzzy", () => {
  const files = ["papafranku.jpeg", "KANA-BOON - Silhouette (TV).mp3", "filthy.png"];

  it("prefers exact case-insensitive match", () => {
    expect(findFileFuzzy(files, "FILTHY.PNG")).toBe("filthy.png");
  });

  it("falls back to same basename with different extension", () => {
    expect(findFileFuzzy(files, "papafranku.jpg")).toBe("papafranku.jpeg");
  });

  it("returns undefined when nothing matches", () => {
    expect(findFileFuzzy(files, "cover.jpg")).toBeUndefined();
  });
});
