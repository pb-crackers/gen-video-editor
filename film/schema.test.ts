/**
 * The parse-time checks, which exist to turn silent wrongness into a sentence.
 *
 * Every case here would otherwise render. A duplicate id produces a film where
 * two graphics answer to one address and a differ patches whichever it finds
 * first; a segment that ends before it starts draws nothing at all; a config
 * stating 1920×1080 while its format says portrait places every graphic for the
 * wrong frame. None of those throw on their own.
 */
import { describe, expect, it } from "vitest";

import { FORMATS } from "./format";
import { parseReel, reelFormat } from "./schema";

const base = { title: "Test", source: "abcd" };

describe("format", () => {
  it("defaults to portrait, so every existing config keeps its meaning", () => {
    expect(parseReel(base).format).toBe("portrait");
    expect(reelFormat(parseReel(base))).toBe(FORMATS.portrait);
  });

  it("accepts landscape", () => {
    const reel = parseReel({ ...base, format: "landscape" });
    expect(reelFormat(reel).width).toBe(1920);
    expect(reelFormat(reel).height).toBe(1080);
  });

  it("refuses a format nobody implements, by name", () => {
    expect(() => parseReel({ ...base, format: "square" })).toThrow();
  });
});

describe("dimensions are derived, and a config that disagrees is refused", () => {
  it("accepts dimensions that match the format", () => {
    expect(() => parseReel({ ...base, format: "landscape", width: 1920, height: 1080 })).not.toThrow();
  });

  it("refuses a landscape size under the default portrait format", () => {
    // The real mistake: someone ports a config over, sets the dimensions, and
    // never adds `format`. Every graphic would be laid out for the wrong frame.
    expect(() => parseReel({ ...base, width: 1920, height: 1080 })).toThrow(/width 1920/);
  });

  it("names both what was said and what the format is", () => {
    expect(() => parseReel({ ...base, width: 1920 })).toThrow(/portrait.*1080×1920/);
  });

  it("catches a mismatched height on its own", () => {
    expect(() => parseReel({ ...base, height: 1080 })).toThrow(/height 1080/);
  });

  it("says nothing when dimensions are simply absent", () => {
    expect(() => parseReel(base)).not.toThrow();
  });
});

describe("segments", () => {
  const seg = (id: string, startMs = 0, endMs = 1000) => ({ id, startMs, endMs });

  it("refuses duplicate ids, because ids are addresses", () => {
    expect(() =>
      parseReel({ ...base, segments: [seg("hook"), seg("hook", 2000, 3000)] }),
    ).toThrow(/hook/);
  });

  it("refuses a segment that ends at or before it starts", () => {
    expect(() => parseReel({ ...base, segments: [seg("hook", 1000, 1000)] })).toThrow(/hook/);
    expect(() => parseReel({ ...base, segments: [seg("hook", 2000, 1000)] })).toThrow(/hook/);
  });

  it("refuses an id that is not path-safe", () => {
    expect(() => parseReel({ ...base, segments: [seg("Hook Two")] })).toThrow();
  });

  it("accepts distinct ids in any order", () => {
    const reel = parseReel({
      ...base,
      segments: [seg("second", 5000, 6000), seg("first", 0, 1000)],
    });
    expect(reel.segments.map((s) => s.id)).toEqual(["second", "first"]);
  });
});
