import { afterEach, describe, expect, it, vi } from "vitest";
import { describeMediaError } from "./media";

function elementWithError(code: number, message = ""): HTMLMediaElement {
  return { error: { code, message } } as unknown as HTMLMediaElement;
}

function stubUserAgent(ua: string): void {
  vi.stubGlobal("navigator", { userAgent: ua });
}

describe("describeMediaError", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns 'unknown error' when the element has no error", () => {
    expect(describeMediaError({ error: null } as unknown as HTMLMediaElement)).toBe("unknown error");
  });

  it("names the error code, no Linux hint on Windows", () => {
    stubUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64)");
    expect(describeMediaError(elementWithError(3, "boom"))).toBe("MEDIA_ERR_DECODE: boom");
  });

  it("appends the GStreamer hint for decode errors on Linux", () => {
    stubUserAgent("Mozilla/5.0 (X11; Linux x86_64)");
    const result = describeMediaError(elementWithError(3));
    expect(result).toContain("MEDIA_ERR_DECODE");
    expect(result).toContain("gstreamer1.0-plugins-ugly");
  });

  it("appends the hint for unsupported-source errors on Linux too", () => {
    stubUserAgent("Mozilla/5.0 (X11; Linux x86_64)");
    expect(describeMediaError(elementWithError(4))).toContain("gstreamer1.0-libav");
  });

  it("does not append the hint for non-codec errors on Linux", () => {
    stubUserAgent("Mozilla/5.0 (X11; Linux x86_64)");
    expect(describeMediaError(elementWithError(2))).toBe("MEDIA_ERR_NETWORK");
  });

  it("does not treat Android as Linux", () => {
    stubUserAgent("Mozilla/5.0 (Linux; Android 14)");
    expect(describeMediaError(elementWithError(3))).toBe("MEDIA_ERR_DECODE");
  });
});
