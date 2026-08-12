/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Speech-to-text, locally.
 *
 * Replaces the hosted `trpc.transcribe` call. The engine already knows how to
 * render an asset down to 16 kHz mono Ogg/Opus for this purpose; those bytes go
 * to the main process, which runs whisper.cpp and hands back word-level timings.
 *
 * Nothing is uploaded and nothing is metered.
 */
import { toast } from "somoto";

import { mainBridge } from "@/lib/ipc";
import { MAIN_CHANNELS } from "@desktop/main-channels";
import { transcodeForTranscription } from "@/components/engine/utils/transcode";

import type { WhisperSegment, WhisperStatus } from "@desktop/main-channels";
import type { Asset } from "@/components/engine/db";

export type { WhisperSegment, WhisperStatus };

const NO_DESKTOP =
  "Local transcription needs the desktop app: whisper.cpp runs outside the browser sandbox.";

/** Is whisper usable right now, without installing anything? */
export function transcriptionStatus(model?: string): Promise<WhisperStatus> {
  if (!window.desktop) throw new Error(NO_DESKTOP);
  return mainBridge.call(MAIN_CHANNELS.WHISPER_STATUS, { model });
}

/** Install whatever is missing. The main process owns the consent prompt. */
export function installTranscription(model?: string): Promise<WhisperStatus> {
  if (!window.desktop) throw new Error(NO_DESKTOP);
  return mainBridge.call(MAIN_CHANNELS.WHISPER_INSTALL, { model });
}

/**
 * Surface install progress while a first run downloads a model or builds
 * whisper.cpp, so a multi-minute setup doesn't look like a hang.
 */
export function watchTranscriptionProgress(): () => void {
  if (!window.desktop) return () => {};
  let toastId: string | number | undefined;
  return mainBridge.handle(MAIN_CHANNELS.WHISPER_PROGRESS, (progress) => {
    const pct = progress.ratio !== undefined ? ` ${Math.round(progress.ratio * 100)}%` : "";
    const message = `${progress.phase}${pct}`;
    if (progress.phase === "Ready") {
      if (toastId !== undefined) toast.dismiss(toastId);
      toastId = undefined;
      return;
    }
    toastId = toast.loading(message, { id: toastId, description: progress.detail });
  });
}

/**
 * Transcribe already-encoded audio bytes. whisper.cpp reads wav/flac/mp3/ogg;
 * the engine produces 16 kHz mono PCM wav for both callers.
 */
export async function transcribeBytes(
  bytes: Uint8Array,
  extension = ".wav",
): Promise<WhisperSegment[]> {
  if (!window.desktop) throw new Error(NO_DESKTOP);

  const segments = await mainBridge.call(MAIN_CHANNELS.WHISPER_TRANSCRIBE, {
    audio: bytes,
    extension,
  });

  if (!segments.length || segments.every((s) => s.words.length === 0)) {
    throw new Error("No speech detected. The audio does not appear to contain recognizable speech.");
  }

  return segments;
}

/**
 * Transcribe an asset's audio. Throws with something actionable when whisper is
 * absent and the user declines to install it.
 */
export async function transcribeAsset(asset: Asset): Promise<WhisperSegment[]> {
  const audio = await transcodeForTranscription(asset);
  return transcribeBytes(new Uint8Array(await audio.arrayBuffer()), ".wav");
}
