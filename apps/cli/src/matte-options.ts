/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Bounds checking for `dapi media matte`, kept apart from the command wiring.
 *
 * `index.ts` runs `program.parse` on import, so validation that lives inline
 * there cannot be exercised without starting the CLI. This returns the message
 * instead of printing it and exiting, which is the only difference; the caller
 * still does both.
 */

export type MatteOptionInput = {
  model?: string;
  ratio?: string;
  despill?: string;
  frames?: string;
};

export type MatteOptionValues = {
  model?: "resnet50" | "mobilenetv3";
  ratio?: number;
  despill?: number;
  maxFrames?: number;
};

/**
 * Every bound here is one the pipeline cannot enforce later: a ratio of 0
 * makes the model produce nothing, and a fractional `--frames` is silently
 * truncated by ffmpeg rather than refused.
 */
export function validateMatteOptions(
  opts: MatteOptionInput,
): { error: string } | { values: MatteOptionValues } {
  if (opts.model !== undefined && opts.model !== "resnet50" && opts.model !== "mobilenetv3") {
    return { error: `--model must be resnet50 or mobilenetv3, got "${opts.model}".` };
  }
  const ratio = opts.ratio !== undefined ? Number(opts.ratio) : undefined;
  if (ratio !== undefined && (!Number.isFinite(ratio) || ratio <= 0 || ratio > 1)) {
    return { error: `--ratio must be a number in (0, 1], got "${opts.ratio}".` };
  }
  const despill = opts.despill !== undefined ? Number(opts.despill) : undefined;
  if (despill !== undefined && (!Number.isFinite(despill) || despill < 0 || despill > 1)) {
    return { error: `--despill must be a number in [0, 1], got "${opts.despill}".` };
  }
  const maxFrames = opts.frames !== undefined ? Number(opts.frames) : undefined;
  if (maxFrames !== undefined && (!Number.isInteger(maxFrames) || maxFrames < 1)) {
    return { error: `--frames must be a positive whole number, got "${opts.frames}".` };
  }

  return { values: { model: opts.model as MatteOptionValues["model"], ratio, despill, maxFrames } };
}
