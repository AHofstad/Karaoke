import { describe, expect, it } from "vitest";
import { parseLoudnormJson } from "../src/lib/playback/loudnorm";

const REAL_STDERR = `size=N/A time=00:03:24.48 bitrate=N/A speed= 142x
[Parsed_loudnorm_0 @ 000001f2a3b4c5d0]
{
	"input_i" : "-9.83",
	"input_tp" : "-0.32",
	"input_lra" : "6.40",
	"input_thresh" : "-20.11",
	"output_i" : "-17.94",
	"output_tp" : "-1.50",
	"output_lra" : "5.90",
	"output_thresh" : "-28.21",
	"normalization_type" : "dynamic",
	"target_offset" : "-0.06"
}
`;

describe("parseLoudnormJson", () => {
  it("parses the JSON block out of real ffmpeg stderr noise", () => {
    const l = parseLoudnormJson(REAL_STDERR);
    expect(l.lufs).toBeCloseTo(-9.83);
    expect(l.tp).toBeCloseTo(-0.32);
  });

  it("throws on -inf (silent track)", () => {
    const stderr = REAL_STDERR.replace('"-9.83"', '"-inf"');
    expect(() => parseLoudnormJson(stderr)).toThrow(/unmeasurable/);
  });

  it("throws when no JSON block is present", () => {
    expect(() => parseLoudnormJson("ffmpeg version 7.0 ... conversion failed")).toThrow(/no loudnorm JSON/);
  });

  it("throws on malformed JSON", () => {
    expect(() => parseLoudnormJson('noise { "input_i" : } noise')).toThrow(/malformed/);
  });

  it("throws when input_tp is missing", () => {
    expect(() => parseLoudnormJson('{ "input_i" : "-9.0" }')).toThrow(/unmeasurable/);
  });
});
