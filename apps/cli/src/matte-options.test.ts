/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Bad values here cost hours, not an error: a run started with a nonsense
 * `--ratio` still spawns ffmpeg and the model and grinds through the footage.
 * These are the checks that have to hold before any of that starts.
 */
import { describe, expect, it } from "vitest";

import { validateMatteOptions } from "./matte-options";

/** The commander shape: every flag arrives as a string or not at all. */
const err = (opts: Parameters<typeof validateMatteOptions>[0]) => {
  const r = validateMatteOptions(opts);
  return "error" in r ? r.error : null;
};
const values = (opts: Parameters<typeof validateMatteOptions>[0]) => {
  const r = validateMatteOptions(opts);
  if ("error" in r) throw new Error(`unexpectedly rejected: ${r.error}`);
  return r.values;
};

describe("validateMatteOptions", () => {
  it("accepts a bare invocation and leaves every value undefined", () => {
    expect(values({})).toEqual({
      model: undefined,
      ratio: undefined,
      despill: undefined,
      maxFrames: undefined,
    });
  });

  it("passes the flags through as numbers once they are in range", () => {
    expect(values({ model: "resnet50", ratio: "0.4", despill: "0.5", frames: "120" })).toEqual({
      model: "resnet50",
      ratio: 0.4,
      despill: 0.5,
      maxFrames: 120,
    });
  });

  it("accepts both model names and nothing else", () => {
    expect(err({ model: "resnet50" })).toBeNull();
    expect(err({ model: "mobilenetv3" })).toBeNull();
    expect(err({ model: "resnet" })).toBe(`--model must be resnet50 or mobilenetv3, got "resnet".`);
    expect(err({ model: "" })).toBe(`--model must be resnet50 or mobilenetv3, got "".`);
  });

  it("takes a ratio in (0, 1] and rejects the ends outside it", () => {
    expect(err({ ratio: "1" })).toBeNull();
    expect(err({ ratio: "0.25" })).toBeNull();
    // 0 is the one that would otherwise run: ffmpeg starts, the model returns
    // nothing usable, and the failure only shows up in the finished file.
    expect(err({ ratio: "0" })).toBe(`--ratio must be a number in (0, 1], got "0".`);
    expect(err({ ratio: "-0.4" })).toBe(`--ratio must be a number in (0, 1], got "-0.4".`);
    expect(err({ ratio: "1.01" })).toBe(`--ratio must be a number in (0, 1], got "1.01".`);
  });

  it("rejects a ratio that is not a number at all", () => {
    expect(err({ ratio: "fast" })).toBe(`--ratio must be a number in (0, 1], got "fast".`);
    expect(err({ ratio: "Infinity" })).toBe(`--ratio must be a number in (0, 1], got "Infinity".`);
    // Number("") is 0, so an empty flag has to fail on the bound, not on NaN.
    expect(err({ ratio: "" })).toBe(`--ratio must be a number in (0, 1], got "".`);
  });

  it("takes a despill in [0, 1], including the 0 that disables it", () => {
    expect(values({ despill: "0" }).despill).toBe(0);
    expect(values({ despill: "1" }).despill).toBe(1);
    expect(err({ despill: "-0.1" })).toBe(`--despill must be a number in [0, 1], got "-0.1".`);
    expect(err({ despill: "1.5" })).toBe(`--despill must be a number in [0, 1], got "1.5".`);
    expect(err({ despill: "none" })).toBe(`--despill must be a number in [0, 1], got "none".`);
  });

  it("takes only a whole positive frame count", () => {
    expect(err({ frames: "1" })).toBeNull();
    expect(err({ frames: "600" })).toBeNull();
    expect(err({ frames: "0" })).toBe(`--frames must be a positive whole number, got "0".`);
    expect(err({ frames: "-5" })).toBe(`--frames must be a positive whole number, got "-5".`);
    expect(err({ frames: "1.5" })).toBe(`--frames must be a positive whole number, got "1.5".`);
    expect(err({ frames: "all" })).toBe(`--frames must be a positive whole number, got "all".`);
  });

  it("reports the first bad flag rather than the last", () => {
    // Fixing one flag at a time is only reasonable if the message names the
    // flag the user has to look at; several messages at once name none.
    expect(err({ model: "rvm", ratio: "9", despill: "9", frames: "0" })).toBe(
      `--model must be resnet50 or mobilenetv3, got "rvm".`,
    );
  });
});
