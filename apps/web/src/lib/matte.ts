/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Speaker mattes, locally.
 *
 * The same arrangement as `transcribe.ts`: the main process owns the model, the
 * consent prompt and the work, and this is the renderer's door to it.
 *
 * The one difference that matters is **size**. Whisper is handed audio bytes
 * over IPC; a matte's input is a whole video and its output is another one, so
 * only *paths* cross this boundary. The caller stages the asset to disk first
 * (see `handleMediaMatte`), because pushing 250 MB through an IPC channel to
 * hand it to a process that could have opened the file is not a trade.
 */
import { toast } from "somoto";

import { mainBridge } from "@/lib/ipc";
import { MAIN_CHANNELS } from "@desktop/main-channels";

import type { MatteRequest, MatteResult, MatteStatus, MatteModel } from "@desktop/main-channels";

export type { MatteResult, MatteStatus, MatteModel };

const NO_DESKTOP =
  "Speaker mattes need the desktop app: RobustVideoMatting runs outside the browser sandbox.";

/** Is the matte model present, without downloading anything? */
export function matteStatus(model?: MatteModel): Promise<MatteStatus> {
  if (!window.desktop) throw new Error(NO_DESKTOP);
  return mainBridge.call(MAIN_CHANNELS.MATTE_STATUS, { model });
}

/** Download the model. The main process owns the consent prompt. */
export function installMatteModel(model?: MatteModel): Promise<MatteStatus> {
  if (!window.desktop) throw new Error(NO_DESKTOP);
  return mainBridge.call(MAIN_CHANNELS.MATTE_INSTALL, { model });
}

/**
 * Surface progress. This is not optional politeness: a two-minute clip is
 * around half an hour of inference, and without a frame counter that is
 * indistinguishable from a hang.
 */
export function watchMatteProgress(): () => void {
  if (!window.desktop) return () => {};
  let toastId: string | number | undefined;
  return mainBridge.handle(MAIN_CHANNELS.MATTE_PROGRESS, (progress) => {
    if (progress.phase === "Done") {
      if (toastId !== undefined) toast.dismiss(toastId);
      toastId = undefined;
      return;
    }
    const pct = progress.ratio !== undefined ? ` ${Math.round(progress.ratio * 100)}%` : "";
    const frames =
      progress.frame !== undefined && progress.totalFrames !== undefined
        ? ` (${progress.frame}/${progress.totalFrames})`
        : "";
    toastId = toast.loading(`${progress.phase}${pct}${frames}`, {
      id: toastId,
      description: progress.detail,
    });
  });
}

/** Cut the speaker out of `input`, writing a VP9+alpha WebM to `output`. */
export function generateMatte(req: MatteRequest): Promise<MatteResult> {
  if (!window.desktop) throw new Error(NO_DESKTOP);
  return mainBridge.call(MAIN_CHANNELS.MATTE_GENERATE, req);
}
