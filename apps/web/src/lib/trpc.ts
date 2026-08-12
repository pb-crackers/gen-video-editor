/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The hosted API client.
 *
 * This fork ships with no API host and no credentials, so every procedure here
 * fails fast unless `VITE_API_URL` is pointed at something. That is deliberate
 * for now: the generative features (image/video/sound/voice, upscale, remove
 * background, analyze) are the only callers left, and they are slated to be
 * re-pointed at user-supplied model providers rather than a metered service.
 *
 * Transcription no longer routes through here — see `lib/transcribe.ts`.
 */
import { createTRPCClient, httpBatchLink, TRPCClientError, type TRPCLink } from "@trpc/client";
import { observable } from "@trpc/server/observable";
import { toast } from "somoto";

import type { AppRouter } from "@diffusionstudio/api-contract";

export const API_URL = import.meta.env.VITE_API_URL ?? "";
export const hasHostedApi = API_URL !== "";

/**
 * Upstream turned a PAYMENT_REQUIRED into an upgrade prompt. There is nothing to
 * upgrade to here, so the failure is reported honestly instead.
 */
const reportFailureLink: TRPCLink<AppRouter> = () => ({ next, op }) =>
  observable((observer) => {
    const sub = next(op).subscribe({
      next: (value) => observer.next(value),
      error: (err) => {
        if (!hasHostedApi) {
          toast.error(
            `“${op.path}” needs a model provider. None is configured in this build.`,
          );
        } else if (err instanceof TRPCClientError && err.data?.code === "PAYMENT_REQUIRED") {
          toast.error(`“${op.path}” was refused by the configured provider.`);
        }
        observer.error(err);
      },
      complete: () => observer.complete(),
    });
    return () => sub.unsubscribe();
  });

export const trpc = createTRPCClient<AppRouter>({
  links: [
    reportFailureLink,
    httpBatchLink({ url: `${API_URL}/api/trpc` }),
  ],
});
