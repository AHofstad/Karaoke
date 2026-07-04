import { describe, expect, it } from "vitest";
import { computeGain, TARGET_LUFS } from "../src/lib/playback/gain";

describe("computeGain", () => {
  it("attenuates a typical YouTube rip (-14 LUFS) toward -18", () => {
    expect(computeGain(-14)).toBeCloseTo(0.6310, 3);
  });

  it("attenuates a loud master (-9 LUFS) harder", () => {
    expect(computeGain(-9)).toBeCloseTo(0.3548, 3);
  });

  it("returns 1 at exactly the target", () => {
    expect(computeGain(TARGET_LUFS)).toBe(1);
  });

  it("never boosts quieter songs (volume caps at 1)", () => {
    expect(computeGain(-22)).toBe(1);
    expect(computeGain(-40)).toBe(1);
  });

  it("returns 1 for unmeasured/invalid input", () => {
    expect(computeGain(undefined)).toBe(1);
    expect(computeGain(Number.NaN)).toBe(1);
    expect(computeGain(Number.NEGATIVE_INFINITY)).toBe(1);
  });

  it("clamps absurdly loud values to the 0.05 floor", () => {
    expect(computeGain(50)).toBe(0.05);
  });
});
