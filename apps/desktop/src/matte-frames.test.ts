/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Both of these fail silently when they are wrong.
 *
 * A torn frame — the tail of one frame followed by the head of the next — is
 * still `size` bytes, so it flows through the model and the encoder without a
 * single error, and comes out the far end looking like the model failed. A
 * despill that pulls the wrong pixels is a skin-tone shift nobody can name.
 * Neither shows up as an exception, so they show up here.
 */
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";

import { despill, frameReader } from "./matte-frames";

const SIZE = 8;

/** Frame `n` is `SIZE` bytes of the value `n`, so a torn frame is visibly mixed. */
const frame = (n: number) => Buffer.alloc(SIZE, n);
const frames = (count: number) => Buffer.concat(Array.from({ length: count }, (_, i) => frame(i)));

/** Feed the whole stream first, then drain — the order real ffmpeg output never guarantees. */
async function readAll(source: Buffer, chunkSizes: number[], end = true) {
  const stream = new PassThrough();
  const next = frameReader(stream, SIZE);

  let offset = 0;
  for (const n of chunkSizes) {
    stream.write(source.subarray(offset, offset + n));
    offset += n;
  }
  if (offset < source.length) stream.write(source.subarray(offset));
  if (end) stream.end();

  const out: Buffer[] = [];
  for (;;) {
    const f = await next();
    if (!f) break;
    out.push(f);
  }
  return out;
}

describe("frameReader", () => {
  it("assembles one frame out of several chunks smaller than a frame", async () => {
    const got = await readAll(frames(1), [1, 1, 3, 3]);
    expect(got).toEqual([frame(0)]);
  });

  it("splits a single chunk that carries several whole frames", async () => {
    const got = await readAll(frames(4), [SIZE * 4]);
    expect(got).toEqual([frame(0), frame(1), frame(2), frame(3)]);
  });

  it("keeps frames intact when a chunk straddles a frame boundary", async () => {
    // Every chunk boundary lands one byte off a frame boundary in one
    // direction or the other; a fencepost error tears every frame here.
    const got = await readAll(frames(3), [SIZE - 1, 2, SIZE - 1, 2]);
    expect(got).toEqual([frame(0), frame(1), frame(2)]);
  });

  it("emits one frame per chunk when chunks are exact multiples of the frame size", async () => {
    const got = await readAll(frames(3), [SIZE, SIZE, SIZE]);
    expect(got).toEqual([frame(0), frame(1), frame(2)]);
  });

  it("never pads a frame out of a chunk larger than a frame but not a multiple", async () => {
    const got = await readAll(frames(4), [SIZE + 3, SIZE * 2 - 3, SIZE]);
    expect(got).toEqual([frame(0), frame(1), frame(2), frame(3)]);
  });

  it("drops a trailing partial frame rather than emitting a short one", async () => {
    // ffmpeg killed mid-frame is the normal end of a `--frames` run.
    const truncated = frames(3).subarray(0, SIZE * 2 + 3);
    const got = await readAll(truncated, [5, 7, 5]);
    expect(got).toEqual([frame(0), frame(1)]);
  });

  it("resolves null once the stream ends cleanly, and keeps doing so", async () => {
    const stream = new PassThrough();
    const next = frameReader(stream, SIZE);
    stream.write(frame(0));
    stream.end();

    expect(await next()).toEqual(frame(0));
    expect(await next()).toBeNull();
    // The loop in generateMatte only asks once more, but a reader that resolved
    // a stale frame on the second ask would re-encode the last frame forever.
    expect(await next()).toBeNull();
  });

  it("resolves a waiter that was queued before any bytes arrived", async () => {
    const stream = new PassThrough();
    const next = frameReader(stream, SIZE);

    const pending = next();
    stream.write(frame(0));
    expect(await pending).toEqual(frame(0));
    stream.end();
    expect(await next()).toBeNull();
  });

  it("hands queued waiters consecutive frames rather than the same one twice", async () => {
    const stream = new PassThrough();
    const next = frameReader(stream, SIZE);

    const both = Promise.all([next(), next()]);
    stream.write(frames(2));
    expect(await both).toEqual([frame(0), frame(1)]);
  });

  it("keeps frames in order for a consumer that awaits one at a time while data trickles in", async () => {
    // This is the real usage: `await nextFrame()` inside the inference loop,
    // with ffmpeg writing whenever it feels like it in between.
    const stream = new PassThrough();
    const next = frameReader(stream, SIZE);
    const source = frames(5);

    const got: Buffer[] = [];
    const consumer = (async () => {
      for (;;) {
        const f = await next();
        if (!f) break;
        got.push(f);
      }
    })();

    let offset = 0;
    for (const n of [3, 9, 1, 20, 7]) {
      stream.write(source.subarray(offset, offset + n));
      offset += n;
      // Yield, so the consumer really is waiting again before the next write.
      await new Promise((r) => setImmediate(r));
    }
    stream.end();

    await consumer;
    expect(got).toEqual([frame(0), frame(1), frame(2), frame(3), frame(4)]);
  });

  it("returns frames that survive later writes to the stream", async () => {
    // Frames are subarray views over a shared concat buffer; a frame handed
    // out must not change when the next chunk arrives.
    const stream = new PassThrough();
    const next = frameReader(stream, SIZE);
    stream.write(frames(2).subarray(0, SIZE + 2));

    const first = await next();
    stream.write(frames(2).subarray(SIZE + 2));
    stream.end();
    const second = await next();

    expect(first).toEqual(frame(0));
    expect(second).toEqual(frame(1));
  });

  /**
   * The regression guard for a measured 6.25 GB.
   *
   * A `data` handler puts a stream in flowing mode, and ffmpeg decodes about
   * ten times faster than resnet50 infers — so without a pause the decoder
   * races ahead and every undelivered frame waits in the heap. A 250-frame
   * matte peaked at 6.25 GB and was still climbing; with the pause it holds
   * flat at 2.88 GB, which is the model and the runtime and nothing else.
   *
   * These assert on `isPaused()` rather than on memory because a heap
   * assertion in a unit test is a flake. The number above is the real evidence;
   * this is what keeps someone from deleting the mechanism.
   */
  it("stops the source once unread frames pile up, instead of buffering them all", async () => {
    const stream = new PassThrough();
    frameReader(stream, SIZE); // nobody ever reads

    for (let i = 0; i < 32; i++) stream.write(frame(i));
    await new Promise((r) => setImmediate(r));

    expect(stream.isPaused()).toBe(true);
  });

  it("starts the source again once the backlog has been read down", async () => {
    const stream = new PassThrough();
    const next = frameReader(stream, SIZE);

    for (let i = 0; i < 32; i++) stream.write(frame(i));
    await new Promise((r) => setImmediate(r));
    expect(stream.isPaused()).toBe(true);

    // Drain the backlog; the reader should hand the stream back its flow.
    for (let i = 0; i < 8; i++) await next();
    expect(stream.isPaused()).toBe(false);
  });

  it("still delivers every frame in order while pausing and resuming", async () => {
    const stream = new PassThrough();
    const next = frameReader(stream, SIZE);

    // Far more than the high-water mark, written before a single read.
    const count = 40;
    for (let i = 0; i < count; i++) stream.write(frame(i));
    stream.end();

    const out: Buffer[] = [];
    for (;;) {
      const f = await next();
      if (!f) break;
      out.push(f);
    }

    expect(out.length).toBe(count);
    // Backpressure must not reorder, drop or tear anything.
    out.forEach((f, i) => expect(f).toEqual(frame(i)));
  });
});

describe("despill", () => {
  it("pulls green down when it sits above the red/blue mean", () => {
    // Fringe pixel: mean 50, green way over it.
    expect(despill(40, 120, 60, 1)).toBe(50);
  });

  it("leaves a skin tone alone, where red > green > blue puts green under the mean", () => {
    expect(despill(200, 150, 110, 1)).toBe(150);
  });

  it("leaves green exactly at the mean untouched", () => {
    expect(despill(60, 100, 140, 1)).toBe(100);
  });

  it("never raises green toward the mean from below, at any amount", () => {
    for (const amount of [0, 0.25, 0.5, 1]) {
      expect(despill(200, 20, 100, amount)).toBe(20);
    }
  });

  it("is a no-op at amount 0", () => {
    expect(despill(40, 120, 60, 0)).toBe(120);
    expect(despill(0, 255, 0, 0)).toBe(255);
  });

  it("clamps green exactly to the mean at amount 1", () => {
    expect(despill(0, 255, 0, 1)).toBe(0);
    expect(despill(10, 200, 30, 1)).toBe(20);
  });

  it("interpolates linearly between the original green and the mean", () => {
    // mean 50, green 150: halfway is 100, a quarter of the way is 125.
    expect(despill(40, 150, 60, 0.5)).toBe(100);
    expect(despill(40, 150, 60, 0.25)).toBe(125);
    expect(despill(40, 150, 60, 0.75)).toBe(75);
  });

  it("works on the unclamped floats the model actually emits", () => {
    // fgr comes out of RVM slightly outside 0..255; clamping happens after.
    expect(despill(-10, 300, 10, 1)).toBe(0);
    expect(despill(-10, 300, 10, 0.5)).toBe(150);
  });
});
