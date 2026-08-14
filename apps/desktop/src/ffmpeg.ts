/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * ffmpeg, found or installed on demand.
 *
 * Same shape and same promises as `whisper.ts`: nothing is downloaded without
 * the user saying yes, an existing install is used when there is one, and an
 * env var can point at a specific binary.
 *
 * ## The thing that makes this more than `which ffmpeg`
 *
 * **A binary named ffmpeg is not evidence that ffmpeg can do the job.**
 * `zscale` is what converts HLG to linear light, which is the first step of
 * every HDR tone-map, and it exists only in builds linked against `libzimg`.
 *
 * Homebrew ships two formulae. `ffmpeg-full` lists `zimg` among its
 * dependencies; plain `ffmpeg` does not (checked against both formulae's
 * dependency lists, 2026-08-13) — so the ffmpeg most machines already have is
 * very likely to fail the tone-map while looking, by every ordinary check,
 * installed and healthy. That last step is an inference from build inputs
 * rather than a measurement: no plain-`ffmpeg` build was on this machine to run.
 * `ffmpeg-full` having `zscale` and `libvpx-vp9` *is* measured.
 *
 * `ffmpeg-full` is marked keg-only, which normally means it is not symlinked
 * onto `PATH`. Homebrew linked it here anyway, because nothing conflicted. Both
 * outcomes are possible on a user's machine, which is the whole argument for
 * checking its `opt/` path explicitly *before* falling back to `PATH`: when
 * both formulae are installed, `PATH` is the one that resolves to the build
 * without `zscale`.
 *
 * So discovery probes capability and picks the first candidate that passes,
 * and a binary that exists but cannot do the work is reported as its own
 * failure rather than as "not installed".
 *
 * ## Why not Remotion's bundled ffmpeg
 *
 * directors-cut carries one at `@remotion/compositor-darwin-arm64/ffmpeg`, and
 * it does pass every check in `REQUIRED`. It is not used here: it needs
 * `DYLD_LIBRARY_PATH` pointed at its own directory to run at all, it is built
 * `--disable-filters` down to an allow-list so most of ffmpeg is simply absent,
 * and depending on it would reach back into the licence this fork exists to be
 * free of.
 */
import { execFile, spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import path from "node:path";

// electron is imported lazily rather than at the top, so discovery and the
// capability probe can be exercised by a plain node process. A module that can
// only run inside Electron is a module whose parsing nobody checks.
const electron = () => import("electron");

/** Overridable so an existing install can be pointed at directly. */
const ENV_BIN = "DIFFUSION_FFMPEG_BIN";

/**
 * What this repo actually asks ffmpeg to do. Each entry is here because
 * something breaks without it, not because it is nice to have.
 */
const REQUIRED = {
  filters: [
    /** HLG/PQ -> linear light. The one brew's plain `ffmpeg` does not have. */
    "zscale",
    /** The tone-map operator itself; needs linear input, hence zscale. */
    "tonemap",
    /** Both are core filters present in any real build — cheap canaries that
     *  the binary is ffmpeg and not something else answering to the name. */
    "format",
    "scale",
  ],
  encoders: [
    /** VP9 is how a matte carries alpha; see docs/matte.md § 1. */
    "libvpx-vp9",
  ],
  decoders: [
    /** The camera originals are 10-bit HEVC. */
    "hevc",
  ],
} as const;

export type FfmpegCapabilities = {
  filters: Set<string>;
  encoders: Set<string>;
  decoders: Set<string>;
};

export type FfmpegStatus = {
  /** A binary that exists *and* has everything in `REQUIRED`. */
  ready: boolean;
  binary: string | null;
  /**
   * A binary that runs but is missing capabilities, with what it lacks. Set
   * only when no capable binary was found — it is the difference between
   * "install ffmpeg" and "the ffmpeg you have is the wrong build", which are
   * very different things to tell someone.
   */
  incapable: { binary: string; missing: string[] } | null;
  installMethod: "homebrew" | null;
};

export type FfmpegProgress = { phase: string; detail?: string };

const exists = async (p: string) => {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
};

const which = (cmd: string): Promise<string | null> =>
  new Promise((resolve) => {
    execFile("/usr/bin/env", ["sh", "-lc", `command -v ${cmd}`], (err, stdout) => {
      resolve(err ? null : stdout.trim() || null);
    });
  });

const brewPrefix = (): Promise<string | null> =>
  new Promise((resolve) => {
    execFile("/usr/bin/env", ["sh", "-lc", "brew --prefix"], (err, stdout) => {
      resolve(err ? null : stdout.trim() || null);
    });
  });

/**
 * The names in one `-filters`/`-encoders`/`-decoders` listing.
 *
 * Every such listing prints one item per line as `<flags> <name> <description>`,
 * so the name is the second field. Split out from `probe` and exported because
 * this is the part that can be wrong without anything visibly breaking: a
 * listing that parses to nothing looks exactly like a build that can do
 * nothing, and both end as "install ffmpeg".
 */
export function parseListing(out: string): Set<string> {
  const names = out
    .split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/))
    // A listing row is `<flags> <name> …`; headers and rules are not.
    .filter((parts) => parts.length >= 2 && /^[A-Z.]+$/i.test(parts[0]) && parts[0] !== parts[1])
    .map((parts) => parts[1]);
  return new Set(names);
}

/**
 * Ask a binary what it can do.
 *
 * Returns null when the binary cannot be executed at all — a broken install and
 * a missing one are the same thing to the caller.
 */
export async function probe(binary: string): Promise<FfmpegCapabilities | null> {
  const ask = (flag: string): Promise<Set<string>> =>
    new Promise((resolve) => {
      execFile(binary, ["-hide_banner", flag], { maxBuffer: 8 << 20 }, (err, stdout) => {
        if (err && !stdout) return resolve(new Set());
        resolve(parseListing(stdout));
      });
    });

  const [filters, encoders, decoders] = await Promise.all([
    ask("-filters"),
    ask("-encoders"),
    ask("-decoders"),
  ]);

  if (filters.size === 0 && encoders.size === 0 && decoders.size === 0) return null;
  return { filters, encoders, decoders };
}

/** Everything in `REQUIRED` that `caps` does not have. */
export function missingCapabilities(caps: FfmpegCapabilities): string[] {
  const missing: string[] = [];
  for (const f of REQUIRED.filters) if (!caps.filters.has(f)) missing.push(`filter:${f}`);
  for (const e of REQUIRED.encoders) if (!caps.encoders.has(e)) missing.push(`encoder:${e}`);
  for (const d of REQUIRED.decoders) if (!caps.decoders.has(d)) missing.push(`decoder:${d}`);
  return missing;
}

/**
 * Where an ffmpeg might be, best first.
 *
 * `ffmpeg-full`'s own `opt/` path comes before `PATH` on purpose: on a machine
 * with both formulae, `ffmpeg-full` stays keg-only and `PATH` resolves to the
 * build *without* `zscale`. Probing still decides — this only sets the order in
 * which candidates get their turn.
 */
async function candidates(): Promise<string[]> {
  const found: string[] = [];
  const push = async (p: string | null) => {
    if (p && !found.includes(p) && (await exists(p))) found.push(p);
  };

  await push(process.env[ENV_BIN] ?? null);

  const prefix = (await brewPrefix()) ?? "/opt/homebrew";
  for (const base of [prefix, "/opt/homebrew", "/usr/local"]) {
    await push(path.join(base, "opt", "ffmpeg-full", "bin", "ffmpeg"));
  }

  await push(await which("ffmpeg"));
  for (const base of ["/opt/homebrew", "/usr/local"]) {
    await push(path.join(base, "bin", "ffmpeg"));
  }

  return found;
}

export async function ffmpegStatus(): Promise<FfmpegStatus> {
  let incapable: FfmpegStatus["incapable"] = null;

  for (const binary of await candidates()) {
    const caps = await probe(binary);
    if (!caps) continue;

    const missing = missingCapabilities(caps);
    if (missing.length === 0) {
      return { ready: true, binary, incapable: null, installMethod: null };
    }
    // Remember the first runnable-but-inadequate one for the error message.
    incapable ??= { binary, missing };
  }

  const installMethod =
    process.platform === "darwin" && (await which("brew")) ? "homebrew" : null;

  return { ready: false, binary: null, incapable, installMethod };
}

function run(cmd: string, args: string[], onLine?: (line: string) => void) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(cmd, args);
    const relay = (buf: Buffer) =>
      buf.toString().split(/\r?\n/).filter(Boolean).forEach((l) => onLine?.(l));
    child.stdout.on("data", relay);
    child.stderr.on("data", relay);
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`${path.basename(cmd)} exited with ${code}`)),
    );
  });
}

/**
 * Install ffmpeg. Never called without the user agreeing first — see
 * `ensureFfmpeg`.
 *
 * `ffmpeg-full` rather than `ffmpeg`, because `ffmpeg` has no `zimg` and so no
 * `zscale`. Installing the wrong one produces a binary that passes every casual
 * check and then fails on the only command we need it for.
 */
export async function installFfmpeg(onProgress?: (p: FfmpegProgress) => void): Promise<FfmpegStatus> {
  const before = await ffmpegStatus();
  if (before.ready) return before;

  if (before.installMethod !== "homebrew") {
    throw new Error(
      "ffmpeg cannot be installed automatically here. Install a build with " +
        "libzimg and libvpx (macOS: `brew install ffmpeg-full`), or set " +
        `${ENV_BIN} to one. Note that a plain \`brew install ffmpeg\` is NOT enough: ` +
        "that formula omits libzimg, so it has no zscale filter.",
    );
  }

  onProgress?.({ phase: "Installing ffmpeg", detail: "brew install ffmpeg-full" });
  await run("brew", ["install", "ffmpeg-full"], (l) =>
    onProgress?.({ phase: "Homebrew", detail: l }),
  );

  const after = await ffmpegStatus();
  if (!after.ready) {
    const detail = after.incapable
      ? ` The build found at ${after.incapable.binary} is missing: ${after.incapable.missing.join(", ")}.`
      : "";
    throw new Error(`Install finished but no usable ffmpeg was found.${detail}`);
  }

  onProgress?.({ phase: "Ready" });
  return after;
}

let inFlight: Promise<FfmpegStatus> | null = null;

/**
 * Resolve a usable ffmpeg, asking the user first when it has to be installed.
 * Concurrent callers share one prompt and one install.
 */
export async function ensureFfmpeg(
  opts: { interactive?: boolean; onProgress?: (p: FfmpegProgress) => void } = {},
): Promise<FfmpegStatus> {
  const status = await ffmpegStatus();
  if (status.ready) return status;
  if (inFlight) return inFlight;

  // A wrong build is a different problem from a missing one, and telling
  // someone to install what they already have is how an hour gets lost.
  const wrongBuild = status.incapable
    ? `\n\nffmpeg is already installed at ${status.incapable.binary}, but that build is ` +
      `missing ${status.incapable.missing.join(", ")}. Homebrew's \`ffmpeg\` formula ` +
      `omits libzimg; \`ffmpeg-full\` is the one that carries it.`
    : "";

  if (opts.interactive === false) {
    throw new Error(
      `This needs an ffmpeg with libzimg and libvpx. Run it once from the app, or set ` +
        `${ENV_BIN}.${wrongBuild}`,
    );
  }

  const { dialog } = await electron();
  const { response } = await dialog.showMessageBox({
    type: "question",
    buttons: ["Install", "Not now"],
    defaultId: 0,
    cancelId: 1,
    title: "Set up video processing",
    message: "Matte and colour work on this machine needs ffmpeg.",
    detail:
      `\`ffmpeg-full\` will be installed with Homebrew. Nothing is uploaded and there is ` +
      `nothing to pay for.${wrongBuild}`,
  });

  if (response !== 0) throw new Error("Cancelled: ffmpeg was not installed.");

  inFlight = installFfmpeg(opts.onProgress).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

/** Run ffmpeg, resolving the binary first. Rejects with ffmpeg's own last words. */
export async function runFfmpeg(
  args: string[],
  opts: { interactive?: boolean; onProgress?: (p: FfmpegProgress) => void } = {},
): Promise<void> {
  const status = await ensureFfmpeg(opts);
  const log: string[] = [];
  try {
    await run(status.binary!, ["-hide_banner", ...args], (line) => {
      log.push(line);
      if (log.length > 40) log.shift();
      opts.onProgress?.({ phase: "ffmpeg", detail: line });
    });
  } catch (e) {
    const tail = log.filter((l) => /error|invalid|no such|failed/i.test(l)).slice(-3).join("; ");
    throw new Error(`${(e as Error).message}${tail ? `: ${tail}` : ""}`);
  }
}

/** The app's home for anything ffmpeg is asked to write. */
export const ffmpegWorkDir = async () =>
  path.join((await electron()).app.getPath("userData"), "ffmpeg-work");

export type MediaInfo = { width: number; height: number; fps: number; durationSec: number };

/**
 * Dimensions, frame rate and duration of a file.
 *
 * `ffprobe` ships alongside `ffmpeg` in every build we accept, so it is
 * resolved as a sibling rather than discovered separately — the capable ffmpeg
 * has already been chosen by then, and picking a *different* build's ffprobe
 * would be how the two disagree about a file.
 */
export async function probeMedia(
  file: string,
  opts: { interactive?: boolean } = {},
): Promise<MediaInfo> {
  const status = await ensureFfmpeg(opts);
  const ffprobe = path.join(path.dirname(status.binary!), "ffprobe");

  const json = await new Promise<string>((resolve, reject) => {
    execFile(
      ffprobe,
      ["-v", "error", "-select_streams", "v:0", "-show_entries",
       "stream=width,height,avg_frame_rate:format=duration", "-of", "json", file],
      { maxBuffer: 1 << 20 },
      (err, stdout) => (err ? reject(err) : resolve(stdout)),
    );
  });

  const parsed = JSON.parse(json) as {
    streams?: Array<{ width?: number; height?: number; avg_frame_rate?: string }>;
    format?: { duration?: string };
  };
  const stream = parsed.streams?.[0];
  if (!stream?.width || !stream?.height) throw new Error(`No video stream in ${path.basename(file)}`);

  // avg_frame_rate is a rational ("30000/1001"), and these files are routinely
  // not integer-rate — the matte has to carry the source's real rate or it
  // drifts against the footage it was cut from.
  const [num, den] = (stream.avg_frame_rate ?? "0/1").split("/").map(Number);
  const fps = den ? num / den : 0;
  if (!fps) throw new Error(`Could not read a frame rate from ${path.basename(file)}`);

  return {
    width: stream.width,
    height: stream.height,
    fps,
    durationSec: Number(parsed.format?.duration ?? 0),
  };
}
