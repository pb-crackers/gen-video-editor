/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Tests for the two pieces of ffmpeg discovery that fail silently.
 *
 * Everything else in `ffmpeg.ts` shells out or talks to Electron, and a test of
 * that would be a test of the mock. These two are pure, and both have the same
 * failure mode: they return a wrong answer that looks like a right one. A
 * listing that parses to nothing is indistinguishable from a build that can do
 * nothing, and a capability check that misses `zscale` sends someone off to
 * install the ffmpeg they already have.
 */
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  missingCapabilities,
  parseListing,
  probe,
  type FfmpegCapabilities,
} from "./ffmpeg";

/** Real `ffmpeg -hide_banner -filters` output, trimmed to the rows that matter. */
const FILTERS = `Filters:
  T.. = Timeline support
  .S. = Slice threading
  A = Audio input/output
  V = Video input/output
  | = Source or sink filter
  ------
 TS aap               AA->A      Apply Affine Projection algorithm to first audio stream.
 .. abench            A->A       Benchmark part of a filtergraph.
 TSC format           V->V       Convert the input video to one of the specified pixel formats.
 ..C scale            V->V       Scale the input video size and/or convert the image format.
 .S tonemap           V->V       Conversion to/from different dynamic ranges.
 .S zscale            V->V       Apply resizing, colorspace and bit depth conversion.
`;

const ENCODERS = `Encoders:
 V..... = Video
 A..... = Audio
 .....D = Supports direct rendering method 1
 ------
 V....D a64multi             Multicolor charset for Commodore 64 (codec a64_multi)
 V....D libvpx-vp9           libvpx VP9 (codec vp9)
 A....D aac                  AAC (Advanced Audio Coding)
`;

const DECODERS = `Decoders:
 V..... = Video
 .F.... = Frame-level multithreading
 ------
 VFS..D hevc                 HEVC (High Efficiency Video Coding)
 V....D libvpx-vp9           libvpx VP9 (codec vp9)
`;

const caps = (
  filters: string[],
  encoders: string[] = ["libvpx-vp9"],
  decoders: string[] = ["hevc"],
): FfmpegCapabilities => ({
  filters: new Set(filters),
  encoders: new Set(encoders),
  decoders: new Set(decoders),
});

/** A build with everything `REQUIRED` asks for. */
const CAPABLE = caps(["zscale", "tonemap", "format", "scale"]);

describe("parseListing", () => {
  it("takes the name from the second column of a -filters listing", () => {
    const names = parseListing(FILTERS);
    expect(names.has("zscale")).toBe(true);
    expect(names.has("tonemap")).toBe(true);
    expect(names.has("format")).toBe(true);
    expect(names.has("scale")).toBe(true);
    expect(names.has("aap")).toBe(true);
  });

  it("reads names whatever width the flags column happens to be", () => {
    // `.S`, `TSC`, `V....D` and `VFS..D` all appear in one real ffmpeg's output.
    expect(parseListing(ENCODERS).has("libvpx-vp9")).toBe(true);
    expect(parseListing(DECODERS).has("hevc")).toBe(true);
    expect(parseListing(DECODERS).has("libvpx-vp9")).toBe(true);
  });

  it("never mistakes a description for a name", () => {
    const names = parseListing(FILTERS);
    // Third column onwards is prose. If it ever leaked into the set, a build
    // could pass the capability check on the strength of its own help text.
    for (const word of ["Timeline", "support", "Benchmark", "V->V", "AA->A", "Video"]) {
      expect(names.has(word)).toBe(false);
    }
  });

  it("ignores the banner, the legend rule and blank lines", () => {
    for (const line of ["Filters:", "Encoders:", "  ------", "", "   ", "\n\n"]) {
      // Legend rows carry a name-shaped first field, so they are the ones with
      // a real chance of being counted; see the `=` note below.
      expect([...parseListing(line)].filter((n) => n !== "=")).toEqual([]);
    }
  });

  it("finds nothing in the output of a binary that is not ffmpeg", () => {
    // What discovery actually meets: a same-named binary that rejects the flag.
    const notFfmpeg = [
      "",
      "usage: ls [-@ABCFGHILOPRSTUWXabcdefghiklmnopqrstuvwxy1%,] [file ...]",
      "ls: invalid option -- _",
      '{"error":"unknown flag: -filters"}',
      "/usr/bin/env: 'ffmpeg': No such file or directory",
    ].join("\n");
    expect(parseListing(notFfmpeg).size).toBe(0);
  });

  it("counts the legend's `=` as a name, which is harmless but real", () => {
    // Documented rather than fixed: `T.. = Timeline support` has a flags-shaped
    // first field and `=` second, so `=` lands in the set. Nothing in REQUIRED
    // is called `=`, so it cannot make a build look capable — but a future
    // caller that counts entries or lists them to a user would see it.
    expect(parseListing(FILTERS).has("=")).toBe(true);
  });
});

describe("missingCapabilities", () => {
  it("reports nothing missing for a build that has everything", () => {
    expect(missingCapabilities(CAPABLE)).toEqual([]);
  });

  it("reports zscale missing for a build without libzimg", () => {
    // The whole reason this module probes capabilities: Homebrew's plain
    // `ffmpeg` formula omits libzimg, so it has every other filter here and
    // still cannot start an HDR tone-map.
    const brewPlain = caps(["tonemap", "format", "scale"]);
    expect(missingCapabilities(brewPlain)).toEqual(["filter:zscale"]);
  });

  it("names one missing filter and nothing else", () => {
    expect(missingCapabilities(caps(["zscale", "format", "scale"]))).toEqual(["filter:tonemap"]);
  });

  it("reports every category a build falls short in, each prefixed with its kind", () => {
    const stripped = caps(["format", "scale"], [], []);
    expect(missingCapabilities(stripped)).toEqual([
      "filter:zscale",
      "filter:tonemap",
      "encoder:libvpx-vp9",
      "decoder:hevc",
    ]);
  });

  it("reports the whole requirement list when a binary answered with nothing", () => {
    const missing = missingCapabilities(caps([], [], []));
    expect(missing).toHaveLength(6);
    expect(missing.every((m) => /^(filter|encoder|decoder):/.test(m))).toBe(true);
  });

  it("is not fooled by a capability landing in the wrong category", () => {
    // A parser bug that filed encoders under filters would otherwise pass.
    const shuffled = caps(["zscale", "tonemap", "format", "scale", "hevc"], ["hevc"], ["libvpx-vp9"]);
    expect(missingCapabilities(shuffled)).toEqual(["encoder:libvpx-vp9", "decoder:hevc"]);
  });
});

/**
 * One end-to-end check against whatever ffmpeg this machine has, so the
 * fixtures above cannot drift away from the format they claim to copy. Skipped
 * where there is no ffmpeg: a suite that fails on a colleague's laptop for
 * reasons that are not the code teaches everyone to ignore it.
 */
const localFfmpeg = [
  process.env.DIFFUSION_FFMPEG_BIN,
  "/opt/homebrew/bin/ffmpeg",
  "/usr/local/bin/ffmpeg",
].find((p): p is string => !!p && existsSync(p));

describe.skipIf(!localFfmpeg)("probe, against the ffmpeg on this machine", () => {
  it("parses the real listings into capabilities", async () => {
    const found = await probe(localFfmpeg!);
    expect(found).not.toBeNull();
    // `format` and `scale` are in every real build; `zscale` deliberately is
    // not asserted, since a plain-brew ffmpeg is exactly the case this module
    // exists to detect and would fail here for the right reason.
    expect(found!.filters.has("format")).toBe(true);
    expect(found!.filters.has("scale")).toBe(true);
    expect(found!.decoders.has("hevc")).toBe(true);
    expect(found!.filters.size).toBeGreaterThan(100);
  });

  it("returns null for a binary that is not ffmpeg", async () => {
    expect(await probe("/bin/ls")).toBeNull();
  });
});
