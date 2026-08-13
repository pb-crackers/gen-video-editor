/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Speaker mattes: the cut-out that lets a graphic sit *behind* the subject.
 *
 * RobustVideoMatting via ONNX, run locally, never billed. The model is
 * downloaded on demand with the user's agreement, exactly like `whisper.ts`.
 *
 * ## Why this shape
 *
 * Every choice here is a measurement in `docs/matte.md`, not a preference:
 *
 * - **Tone-map before segmenting.** RVM is trained on sRGB and the camera
 *   originals are BT.2020/HLG. This is the *only* place a tone-map belongs —
 *   the renderer already handles HDR correctly, so tone-mapping footage before
 *   a mount would be a second lossy pass (§ 1).
 * - **resnet50 at `downsample_ratio` 0.4.** Ratio 1.0 costs hours and buys 1.5
 *   points; 0.4 is the knee (§ 4).
 * - **onnxruntime-node with CoreML.** Measured against three alternatives.
 *   onnxruntime-web's WebGPU backend returns a *wrong* matte — 9% coverage
 *   where 43% is correct — and is no faster than wasm, so the in-app route was
 *   rejected (§ 4b).
 * - **Composite from `fgr`, never the source frame.** `fgr` is the
 *   decontaminated foreground; using the raw frame leaks the room in around
 *   every edge (§ 4).
 *
 * ## Why it streams
 *
 * ffmpeg decodes and tone-maps into this process, and this process writes RGBA
 * into a second ffmpeg that encodes VP9 with alpha. Nothing is staged on disk:
 * two minutes of 1080×1920 raw frames is ~21 GB, and the intermediate is worth
 * exactly nothing once encoded.
 */
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, rm, stat, copyFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import ort from "onnxruntime-node";

import { ensureFfmpeg, probeMedia, type MediaInfo } from "./ffmpeg";

const electron = () => import("electron");

/** Overridable so an existing model can be pointed at directly. */
const ENV_MODEL = "DIFFUSION_RVM_MODEL";

export type MatteModel = "resnet50" | "mobilenetv3";

const MODEL_URL: Record<MatteModel, string> = {
  resnet50:
    "https://github.com/PeterL1n/RobustVideoMatting/releases/download/v1.0.0/rvm_resnet50_fp32.onnx",
  mobilenetv3:
    "https://github.com/PeterL1n/RobustVideoMatting/releases/download/v1.0.0/rvm_mobilenetv3_fp32.onnx",
};

/** Approximate download sizes, for the consent dialog. */
const MODEL_MB: Record<MatteModel, number> = { resnet50: 107, mobilenetv3: 15 };

/**
 * The knee of the quality/speed curve. Measured: cable pixels kept were 96.7%
 * at 0.25 and 98.2% at 1.0, while 1.0 costs 5.6 hours for a 2-minute video.
 */
export const DEFAULT_RATIO = 0.4;
export const DEFAULT_MODEL: MatteModel = "resnet50";

export type MatteStatus = { ready: boolean; model: string | null; modelName: MatteModel };
export type MatteProgress = {
  phase: string;
  detail?: string;
  ratio?: number;
  /** Frames finished, when the phase is inference. */
  frame?: number;
  totalFrames?: number;
};

const exists = async (p: string) => {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
};

const modelDir = async () => path.join((await electron()).app.getPath("userData"), "matte", "models");
const modelPath = async (m: MatteModel) => path.join(await modelDir(), `rvm_${m}_fp32.onnx`);

async function findModel(m: MatteModel): Promise<string | null> {
  const override = process.env[ENV_MODEL];
  if (override && (await exists(override))) return override;
  const managed = await modelPath(m);
  return (await exists(managed)) ? managed : null;
}

export async function matteStatus(modelName: MatteModel = DEFAULT_MODEL): Promise<MatteStatus> {
  const model = await findModel(modelName);
  return { ready: !!model, model, modelName };
}

async function download(url: string, dest: string, onProgress?: (p: MatteProgress) => void) {
  await mkdir(path.dirname(dest), { recursive: true });
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok || !res.body) throw new Error(`Model download failed: ${res.status} ${res.statusText}`);

  const total = Number(res.headers.get("content-length") ?? 0);
  let seen = 0;
  const body = Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]);
  body.on("data", (chunk: Buffer) => {
    seen += chunk.length;
    if (total) {
      onProgress?.({
        phase: "Downloading matte model",
        ratio: seen / total,
        detail: `${Math.round(seen / 1e6)} / ${Math.round(total / 1e6)} MB`,
      });
    }
  });

  // Land the bytes beside the target and rename, so an interrupted download is
  // never mistaken for a usable model next run.
  const partial = `${dest}.part`;
  await pipeline(body, createWriteStream(partial));
  await copyFile(partial, dest);
  await rm(partial, { force: true });
}

let inFlight: Promise<MatteStatus> | null = null;

/** Resolve a usable model, asking the user before fetching one. */
export async function ensureMatteModel(
  modelName: MatteModel = DEFAULT_MODEL,
  opts: { interactive?: boolean; onProgress?: (p: MatteProgress) => void } = {},
): Promise<MatteStatus> {
  const status = await matteStatus(modelName);
  if (status.ready) return status;
  if (inFlight) return inFlight;

  if (opts.interactive === false) {
    throw new Error(
      `Matte generation needs the RVM ${modelName} model. Run it once from the app, ` +
        `or set ${ENV_MODEL} to an existing rvm_${modelName}_fp32.onnx.`,
    );
  }

  const { dialog } = await electron();
  const { response } = await dialog.showMessageBox({
    type: "question",
    buttons: ["Download", "Not now"],
    defaultId: 0,
    cancelId: 1,
    title: "Set up speaker mattes",
    message: "Cutting the speaker out is done on this machine with RobustVideoMatting.",
    detail:
      `The ${modelName} model (~${MODEL_MB[modelName]} MB) still needs to be downloaded. ` +
      `Nothing is uploaded and there is nothing to pay for.`,
  });
  if (response !== 0) throw new Error("Cancelled: the matte model was not downloaded.");

  inFlight = (async () => {
    await download(MODEL_URL[modelName], await modelPath(modelName), opts.onProgress);
    const after = await matteStatus(modelName);
    if (!after.ready) throw new Error("Download finished but the model is still missing.");
    return after;
  })().finally(() => {
    inFlight = null;
  });

  return inFlight;
}

/**
 * Pull green back where it exceeds the mean of red and blue.
 *
 * The room's LED wash bleeds into edge pixels and reads as a cyan fringe
 * against a dark plate. Skin is naturally r > g > b, so its green sits *below*
 * that mean and this leaves it alone; only genuinely green-cast pixels move.
 * Killing the light fixes it better than any of this (§ 5).
 */
function despill(r: number, g: number, b: number, amount: number): number {
  const mean = (r + b) / 2;
  return g > mean ? g - (g - mean) * amount : g;
}

/** Reads exactly `size`-byte frames out of a stream that knows nothing about frames. */
function frameReader(stream: NodeJS.ReadableStream, size: number) {
  let pending: Buffer[] = [];
  let pendingBytes = 0;
  const waiters: Array<(f: Buffer | null) => void> = [];
  let done = false;

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
  });
  stream.on("end", () => {
    done = true;
    flush();
  });

  return () =>
    new Promise<Buffer | null>((resolve) => {
      waiters.push(resolve);
      flush();
    });
}

/**
 * The "no state yet" seed. RVM grows it to the real shape on frame one, so the
 * declared type has to be the general `Tensor` — the outputs threaded back in
 * are not the same concrete type this returns.
 */
const zeroState = (): ort.Tensor => new ort.Tensor("float32", new Float32Array(1), [1, 1, 1, 1]);

export type MatteOptions = {
  model?: MatteModel;
  /** `downsample_ratio`. Lower is faster; 0.4 is the measured knee. */
  ratio?: number;
  /** 0 disables despill, 1 clamps green fully to the red/blue mean. */
  despill?: number;
  /** Stop after N frames. For checking a setup without paying for the whole clip. */
  maxFrames?: number;
  interactive?: boolean;
  onProgress?: (p: MatteProgress) => void;
};

/**
 * Turn `input` into a VP9 WebM carrying alpha.
 *
 * The output composites directly in this engine — `VideoExporter` asks
 * mediabunny for alpha when the track has it (§ 1). It is deliberately *not* a
 * pre-multiplied composite over black: alpha is carried, so the graphic behind
 * the subject is chosen at edit time rather than baked here.
 */
export async function generateMatte(
  input: string,
  output: string,
  opts: MatteOptions = {},
): Promise<{ frames: number; seconds: number; info: MediaInfo }> {
  const modelName = opts.model ?? DEFAULT_MODEL;
  const ratioValue = opts.ratio ?? DEFAULT_RATIO;
  const despillAmount = opts.despill ?? 1;

  const [ffmpeg, model, info] = await Promise.all([
    ensureFfmpeg({ interactive: opts.interactive }),
    ensureMatteModel(modelName, { interactive: opts.interactive, onProgress: opts.onProgress }),
    probeMedia(input, { interactive: opts.interactive }),
  ]);

  const { width: W, height: H, fps } = info;
  const frameBytes = W * H * 3;
  const totalFrames = opts.maxFrames ?? Math.max(1, Math.round(info.durationSec * fps));

  opts.onProgress?.({ phase: "Loading model", detail: `${modelName} @ ratio ${ratioValue}` });
  const session = await ort.InferenceSession.create(model.model!, {
    // Measured: resnet50 goes 1.99 -> 5.42 fps under CoreML (§ 4b).
    executionProviders: ["coreml"],
  });

  await mkdir(path.dirname(output), { recursive: true });

  // Decode + tone-map. HDR -> BT.709 here and nowhere else in the chain.
  const decodeArgs = [
    "-loglevel", "error", "-i", input,
    ...(opts.maxFrames ? ["-frames:v", String(opts.maxFrames)] : []),
    "-vf",
    "zscale=t=linear:npl=100,tonemap=hable:desat=0," +
      "zscale=p=bt709:t=bt709:m=bt709:r=tv,format=rgb24",
    "-f", "rawvideo", "-pix_fmt", "rgb24", "-",
  ];

  // Encode. `-auto-alt-ref 0` is required: libvpx-vp9's alt-ref frames and the
  // alpha side-channel are mutually exclusive, and with it on the alpha is
  // silently dropped rather than refused.
  const encodeArgs = [
    "-loglevel", "error", "-y",
    "-f", "rawvideo", "-pix_fmt", "rgba", "-s", `${W}x${H}`, "-r", String(fps), "-i", "-",
    "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-auto-alt-ref", "0",
    "-b:v", "0", "-crf", "28", "-row-mt", "1",
    output,
  ];

  const decoder = spawn(ffmpeg.binary!, decodeArgs, { stdio: ["ignore", "pipe", "pipe"] });
  const encoder = spawn(ffmpeg.binary!, encodeArgs, { stdio: ["pipe", "ignore", "pipe"] });

  const errors: string[] = [];
  const watch = (p: { stderr: NodeJS.ReadableStream | null }, who: string) =>
    p.stderr?.on("data", (b: Buffer) =>
      b.toString().split(/\r?\n/).filter(Boolean).forEach((l) => errors.push(`${who}: ${l}`)),
    );
  watch(decoder, "decode");
  watch(encoder, "encode");

  const nextFrame = frameReader(decoder.stdout, frameBytes);
  const encoderDone = new Promise<void>((resolve, reject) => {
    encoder.on("error", reject);
    encoder.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`encode exited ${code}: ${errors.slice(-4).join("; ")}`)),
    );
  });

  const src = new Float32Array(3 * W * H);
  const rgba = Buffer.allocUnsafe(W * H * 4);
  const ratio = new ort.Tensor("float32", new Float32Array([ratioValue]), [1]);
  let [r1, r2, r3, r4] = [zeroState(), zeroState(), zeroState(), zeroState()];

  const started = Date.now();
  let frames = 0;
  const px = W * H;

  try {
    for (;;) {
      const frame = await nextFrame();
      if (!frame) break;

      for (let i = 0; i < px; i++) {
        src[i] = frame[i * 3] / 255;
        src[px + i] = frame[i * 3 + 1] / 255;
        src[2 * px + i] = frame[i * 3 + 2] / 255;
      }

      const out = await session.run({
        src: new ort.Tensor("float32", src, [1, 3, H, W]),
        r1i: r1, r2i: r2, r3i: r3, r4i: r4,
        // rank 1, not a scalar — the model rejects rank 0.
        downsample_ratio: ratio,
      });

      // Carry the recurrent state forward. This is what makes RVM temporally
      // stable, and getting it wrong is invisible on any single frame.
      [r1, r2, r3, r4] = [out.r1o, out.r2o, out.r3o, out.r4o];

      const fgr = out.fgr.data as Float32Array;
      const pha = out.pha.data as Float32Array;

      for (let i = 0; i < px; i++) {
        const r = fgr[i] * 255;
        const g = fgr[px + i] * 255;
        const b = fgr[2 * px + i] * 255;
        const o = i * 4;
        rgba[o] = r < 0 ? 0 : r > 255 ? 255 : r;
        const dg = despillAmount ? despill(r, g, b, despillAmount) : g;
        rgba[o + 1] = dg < 0 ? 0 : dg > 255 ? 255 : dg;
        rgba[o + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
        const a = pha[i] * 255;
        rgba[o + 3] = a < 0 ? 0 : a > 255 ? 255 : a;
      }

      // Respect the encoder's backpressure; without this a long clip buys an
      // unbounded buffer in this process instead of a bounded one in ffmpeg.
      if (!encoder.stdin.write(rgba)) {
        await new Promise<void>((resolve) => encoder.stdin.once("drain", resolve));
      }

      frames++;
      if (frames % 10 === 0 || frames === totalFrames) {
        opts.onProgress?.({
          phase: "Matting",
          frame: frames,
          totalFrames,
          ratio: frames / totalFrames,
          detail: `${(frames / ((Date.now() - started) / 1000)).toFixed(2)} fps`,
        });
      }
    }
  } finally {
    encoder.stdin.end();
    decoder.kill("SIGTERM");
  }

  await encoderDone;

  if (frames === 0) {
    throw new Error(`No frames were decoded from ${path.basename(input)}: ${errors.slice(-4).join("; ")}`);
  }

  const seconds = (Date.now() - started) / 1000;
  opts.onProgress?.({ phase: "Done", detail: `${frames} frames in ${seconds.toFixed(1)}s` });
  return { frames, seconds, info };
}
