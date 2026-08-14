/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The pure pixel- and byte-level helpers of the matte pipeline.
 *
 * Split out of `matte.ts` so they can be unit tested without loading
 * onnxruntime-node, a 259 MB native module that a test of arithmetic and
 * stream buffering has no business paying for.
 */

/**
 * Pull green back where it exceeds the mean of red and blue.
 *
 * The room's LED wash bleeds into edge pixels and reads as a cyan fringe
 * against a dark plate. Skin is naturally r > g > b, so its green sits *below*
 * that mean and this leaves it alone; only genuinely green-cast pixels move.
 * Killing the light fixes it better than any of this (§ 5).
 */
export function despill(r: number, g: number, b: number, amount: number): number {
  const mean = (r + b) / 2;
  return g > mean ? g - (g - mean) * amount : g;
}

/**
 * How many whole frames may sit unread before the source is told to stop.
 *
 * Small on purpose. A 1080×1920 rgb24 frame is 6.2 MB, so this is a ~25 MB
 * ceiling; enough that the reader never waits on a decoder that is merely
 * bursty, far too little to hide the runaway below.
 */
const HIGH_WATER_FRAMES = 4;

/**
 * Reads exactly `size`-byte frames out of a stream that knows nothing about
 * frames.
 *
 * ## Why this pauses the stream
 *
 * Attaching a `data` handler puts a stream in flowing mode, and it then arrives
 * as fast as the producer can push. That is a disaster in this particular
 * pipeline, because the two ends run at wildly different speeds: ffmpeg decodes
 * and tone-maps roughly an order of magnitude faster than resnet50 infers at
 * ~5 fps. So ffmpeg finishes long before inference does and every undelivered
 * frame waits in this process's heap.
 *
 * Measured before this guard existed: a **250-frame** matte peaked at
 * **6.25 GB** RSS and was still climbing. A two-minute clip is ~4,200 frames —
 * the exact multi-gigabyte intermediate that `matte.ts`'s docstring claims
 * streaming avoids. It was avoided on disk and reintroduced in memory.
 *
 * The encode side already had backpressure (`generateMatte` awaits `drain`);
 * this is the same contract on the decode side.
 */
export function frameReader(stream: NodeJS.ReadableStream, size: number) {
  let pending: Buffer[] = [];
  let pendingBytes = 0;
  const waiters: Array<(f: Buffer | null) => void> = [];
  let done = false;
  let paused = false;

  const highWater = size * HIGH_WATER_FRAMES;

  const flush = () => {
    while (waiters.length && (pendingBytes >= size || done)) {
      if (pendingBytes < size) {
        waiters.shift()!(null);
        continue;
      }
      const joined = Buffer.concat(pending, pendingBytes);
      waiters.shift()!(joined.subarray(0, size));
      pending = [joined.subarray(size)];
      pendingBytes = pending[0].length;
    }
  };

  stream.on("data", (c: Buffer) => {
    pending.push(c);
    pendingBytes += c.length;
    flush();
    // After flushing: whatever a waiting consumer took is already gone, so this
    // only holds back a producer genuinely running ahead of one.
    if (!paused && pendingBytes >= highWater) {
      stream.pause();
      paused = true;
    }
  });
  stream.on("end", () => {
    done = true;
    flush();
  });

  return () =>
    new Promise<Buffer | null>((resolve) => {
      waiters.push(resolve);
      flush();
      // Resume only once the backlog has actually drained below the mark,
      // rather than on every read, so a slow consumer does not toggle the
      // stream on and off once per frame.
      if (paused && pendingBytes < highWater) {
        stream.resume();
        paused = false;
      }
    });
}
