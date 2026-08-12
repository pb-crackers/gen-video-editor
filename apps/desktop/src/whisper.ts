/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Local speech-to-text via whisper.cpp.
 *
 * Transcription in this fork never leaves the machine and is never billed. The
 * binary and the model are found if the user already has them and installed on
 * demand if not — install is always something the user says yes to, never a
 * silent multi-hundred-megabyte download.
 *
 * Deliberately not using `@remotion/install-whisper-cpp`, which does this job
 * well but ships under the Remotion licence; this fork exists partly to be free
 * of that.
 */
import { spawn, execFile } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile, chmod, readdir, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { app, dialog } from "electron";

/** whisper.cpp release used when building from source. */
const WHISPER_VERSION = "1.9.1";
const SOURCE_TARBALL = (v: string) =>
  `https://github.com/ggml-org/whisper.cpp/archive/refs/tags/v${v}.tar.gz`;
const MODEL_URL = (model: string) =>
  `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${model}.bin`;

/** Overridable so an existing install can be pointed at directly. */
const ENV_BIN = "DIFFUSION_WHISPER_BIN";
const ENV_MODEL = "DIFFUSION_WHISPER_MODEL";
const ENV_MODEL_NAME = "DIFFUSION_WHISPER_MODEL_NAME";

const DEFAULT_MODEL = process.env[ENV_MODEL_NAME] ?? "small.en";

export type WhisperWord = { text: string; start: number; end: number };
export type WhisperSegment = { text: string; words: WhisperWord[] };

export type WhisperStatus = {
  /** True when both a binary and a model are present. */
  ready: boolean;
  binary: string | null;
  model: string | null;
  modelName: string;
  /** How a missing binary could be obtained on this machine, if at all. */
  installMethod: "homebrew" | "source" | null;
  missing: Array<"binary" | "model">;
};

export type WhisperProgress = { phase: string; detail?: string; ratio?: number };

const home = () => app.getPath("userData");
const managedDir = () => path.join(home(), "whisper");
const managedBin = () => path.join(managedDir(), "bin", "whisper-cli");
const managedModel = (model: string) => path.join(managedDir(), "models", `ggml-${model}.bin`);

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

/** Places a user may already have whisper.cpp, cheapest lookup first. */
async function findBinary(): Promise<string | null> {
  const override = process.env[ENV_BIN];
  if (override && (await exists(override))) return override;

  if (await exists(managedBin())) return managedBin();

  for (const name of ["whisper-cli", "whisper-cpp", "main"]) {
    const found = await which(name);
    // `main` is whisper.cpp's legacy binary name and also a very common word;
    // only trust it when it sits next to a sibling that names the project.
    if (found && (name !== "main" || found.includes("whisper"))) return found;
  }

  const common = [
    "/opt/homebrew/bin/whisper-cli",
    "/usr/local/bin/whisper-cli",
    path.join(app.getPath("home"), "directors-cut/whisper.cpp/build/bin/whisper-cli"),
  ];
  for (const p of common) if (await exists(p)) return p;

  return null;
}

async function findModel(model: string): Promise<string | null> {
  const override = process.env[ENV_MODEL];
  if (override && (await exists(override))) return override;
  if (await exists(managedModel(model))) return managedModel(model);

  // A sibling of a discovered binary is the usual layout for a manual build.
  const bin = await findBinary();
  if (bin) {
    for (const dir of [path.dirname(bin), path.resolve(path.dirname(bin), "../.."), path.resolve(path.dirname(bin), "../../models")]) {
      const candidate = path.join(dir, `ggml-${model}.bin`);
      if (await exists(candidate)) return candidate;
    }
  }
  return null;
}

export async function whisperStatus(model = DEFAULT_MODEL): Promise<WhisperStatus> {
  const [binary, modelPath] = await Promise.all([findBinary(), findModel(model)]);
  const missing: Array<"binary" | "model"> = [];
  if (!binary) missing.push("binary");
  if (!modelPath) missing.push("model");

  let installMethod: WhisperStatus["installMethod"] = null;
  if (!binary) {
    if (process.platform === "darwin" && (await which("brew"))) installMethod = "homebrew";
    else if ((await which("cmake")) && (await which("make"))) installMethod = "source";
  }

  return {
    ready: missing.length === 0,
    binary,
    model: modelPath,
    modelName: model,
    installMethod,
    missing,
  };
}

async function download(url: string, dest: string, onProgress?: (p: WhisperProgress) => void, label = "Downloading") {
  await mkdir(path.dirname(dest), { recursive: true });
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok || !res.body) throw new Error(`${label} failed: ${res.status} ${res.statusText}`);

  const total = Number(res.headers.get("content-length") ?? 0);
  let seen = 0;
  const body = Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]);
  body.on("data", (chunk: Buffer) => {
    seen += chunk.length;
    if (total) onProgress?.({ phase: label, ratio: seen / total, detail: `${Math.round(seen / 1e6)} / ${Math.round(total / 1e6)} MB` });
  });

  const partial = `${dest}.part`;
  await pipeline(body, createWriteStream(partial));
  // Rename only once the bytes are all there, so an interrupted download is
  // never mistaken for a usable file on the next run.
  await copyFile(partial, dest);
  await rm(partial, { force: true });
}

async function run(cmd: string, args: string[], onLine?: (line: string) => void, cwd?: string) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, env: { ...process.env, CMAKE_POLICY_VERSION_MINIMUM: "3.5" } });
    const relay = (buf: Buffer) => buf.toString().split(/\r?\n/).filter(Boolean).forEach((l) => onLine?.(l));
    child.stdout.on("data", relay);
    child.stderr.on("data", relay);
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`${path.basename(cmd)} exited with ${code}`)),
    );
  });
}

async function buildFromSource(onProgress?: (p: WhisperProgress) => void) {
  const work = path.join(managedDir(), "src");
  await rm(work, { recursive: true, force: true });
  await mkdir(work, { recursive: true });

  const tarball = path.join(work, "whisper.tar.gz");
  await download(SOURCE_TARBALL(WHISPER_VERSION), tarball, onProgress, "Downloading whisper.cpp");

  onProgress?.({ phase: "Extracting" });
  await run("tar", ["-xzf", tarball, "-C", work, "--strip-components=1"]);

  onProgress?.({ phase: "Building whisper.cpp", detail: "this takes a few minutes" });
  await run("cmake", ["-B", "build", "-DCMAKE_BUILD_TYPE=Release"], (l) => onProgress?.({ phase: "Configuring", detail: l }), work);
  await run("cmake", ["--build", "build", "--config", "Release", "-j"], (l) => onProgress?.({ phase: "Building", detail: l }), work);

  const built = path.join(work, "build", "bin", "whisper-cli");
  if (!(await exists(built))) throw new Error("Build finished but whisper-cli was not produced.");

  await mkdir(path.dirname(managedBin()), { recursive: true });
  await copyFile(built, managedBin());
  await chmod(managedBin(), 0o755);

  // The build tree also carries the shared libraries the binary links against.
  const libDir = path.join(work, "build", "src");
  for (const dir of [path.join(work, "build", "bin"), libDir, path.join(work, "build", "ggml", "src")]) {
    if (!(await exists(dir))) continue;
    for (const entry of await readdir(dir)) {
      if (!/\.(dylib|so|dll)(\.\d+)*$/.test(entry)) continue;
      await copyFile(path.join(dir, entry), path.join(path.dirname(managedBin()), entry)).catch(() => {});
    }
  }
}

/**
 * Install whatever is missing. Never called without the user agreeing first —
 * see `ensureWhisper`.
 */
export async function installWhisper(
  model = DEFAULT_MODEL,
  onProgress?: (p: WhisperProgress) => void,
): Promise<WhisperStatus> {
  const before = await whisperStatus(model);

  if (before.missing.includes("binary")) {
    if (before.installMethod === "homebrew") {
      onProgress?.({ phase: "Installing whisper.cpp", detail: "brew install whisper-cpp" });
      await run("brew", ["install", "whisper-cpp"], (l) => onProgress?.({ phase: "Homebrew", detail: l }));
    } else if (before.installMethod === "source") {
      await buildFromSource(onProgress);
    } else {
      throw new Error(
        "whisper.cpp is not installed and cannot be installed automatically here. " +
          "Install it manually (macOS: `brew install whisper-cpp`), or set " +
          `${ENV_BIN} to an existing whisper-cli binary.`,
      );
    }
  }

  if (before.missing.includes("model")) {
    await download(MODEL_URL(model), managedModel(model), onProgress, `Downloading model ${model}`);
  }

  const after = await whisperStatus(model);
  if (!after.ready) throw new Error("Install finished but whisper is still not usable.");
  onProgress?.({ phase: "Ready" });
  return after;
}

let inFlight: Promise<WhisperStatus> | null = null;

/**
 * Resolve a usable whisper install, asking the user first when something has to
 * be fetched. Concurrent callers share one prompt and one install.
 */
export async function ensureWhisper(
  model = DEFAULT_MODEL,
  opts: { interactive?: boolean; onProgress?: (p: WhisperProgress) => void } = {},
): Promise<WhisperStatus> {
  const status = await whisperStatus(model);
  if (status.ready) return status;
  if (inFlight) return inFlight;

  const wants = status.missing.join(" and ");
  if (opts.interactive === false) {
    throw new Error(
      `Local transcription needs the whisper ${wants}. Run it once from the app, ` +
        `or set ${ENV_BIN} / ${ENV_MODEL}.`,
    );
  }

  const size = status.missing.includes("model") ? " The model is a few hundred MB." : "";
  const { response } = await dialog.showMessageBox({
    type: "question",
    buttons: ["Install", "Not now"],
    defaultId: 0,
    cancelId: 1,
    title: "Set up local transcription",
    message: `Captions are generated on this machine with whisper.cpp.`,
    detail:
      `The ${wants} still needs to be installed.${size} Nothing is uploaded and there is ` +
      `nothing to pay for.`,
  });

  if (response !== 0) throw new Error("Transcription cancelled: whisper.cpp was not installed.");

  inFlight = installWhisper(model, opts.onProgress).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

/** Merge whisper's sub-word tokens into words; a leading space starts a new one. */
function tokensToWords(tokens: Array<{ text: string; offsets?: { from: number; to: number } }>): WhisperWord[] {
  const words: WhisperWord[] = [];
  for (const tok of tokens) {
    // Control tokens ([_BEG_], [_TT_123]) carry no audio.
    if (!tok.offsets || /^\[_.*_\]$/.test(tok.text.trim())) continue;
    const raw = tok.text;
    const text = raw.trim();
    if (!text) continue;

    const start = tok.offsets.from / 1000;
    const end = tok.offsets.to / 1000;

    if (raw.startsWith(" ") || words.length === 0) {
      words.push({ text, start, end });
    } else {
      const last = words[words.length - 1];
      last.text += text;
      last.end = end;
    }
  }
  return words;
}

/**
 * Transcribe raw audio bytes. The caller supplies an encoded audio file that
 * whisper.cpp can read (wav/flac/mp3/ogg); the engine already produces 16 kHz
 * mono Ogg/Opus for this purpose.
 */
export async function transcribeAudio(
  audio: Uint8Array,
  opts: { model?: string; extension?: string; interactive?: boolean; onProgress?: (p: WhisperProgress) => void } = {},
): Promise<WhisperSegment[]> {
  const model = opts.model ?? DEFAULT_MODEL;
  const status = await ensureWhisper(model, { interactive: opts.interactive, onProgress: opts.onProgress });

  const dir = await mkdir(path.join(tmpdir(), `whisper-${Date.now()}-${Math.random().toString(36).slice(2)}`), {
    recursive: true,
  }).then((p) => p!);
  const input = path.join(dir, `audio${opts.extension ?? ".ogg"}`);
  const outBase = path.join(dir, "out");

  try {
    await writeFile(input, audio);
    opts.onProgress?.({ phase: "Transcribing" });

    // whisper-cli exits 0 even when it fails to read the audio, so the exit
    // code cannot be trusted — the output file is the only real signal, and its
    // own log is the only place the reason appears.
    const log: string[] = [];
    await run(
      status.binary!,
      ["-m", status.model!, "-f", input, "-oj", "-ojf", "-of", outBase, "--no-prints"],
      (line) => {
        log.push(line);
        if (log.length > 40) log.shift();
      },
    );

    if (!(await exists(`${outBase}.json`))) {
      const reason = log.filter((l) => /error|failed/i.test(l)).join("; ") || log.slice(-3).join("; ");
      throw new Error(`whisper.cpp produced no transcript${reason ? `: ${reason}` : "."}`);
    }

    const parsed = JSON.parse(await readFile(`${outBase}.json`, "utf8")) as {
      transcription?: Array<{ text?: string; tokens?: Array<{ text: string; offsets?: { from: number; to: number } }> }>;
    };

    return (parsed.transcription ?? [])
      .map((seg) => ({ text: (seg.text ?? "").trim(), words: tokensToWords(seg.tokens ?? []) }))
      .filter((seg) => seg.words.length > 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
