/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { hasComponent, entityExists } from "bitecs";
import { transcribeBytes } from "@/lib/transcribe";
import { PaintType, getEntityTree, getParentEntity, secondsToFrames, loadAsset } from "@/components/engine";
import { createEncoder } from "@/components/engine/encode/encoder";
import { resolveTranscript } from "@/components/engine/decoders/caption/utils";
import { assert } from "@/utils";

import type { Transcript } from "@diffusionstudio/api-contract";
import type { Engine, EngineWorld } from "@/components/engine";
import type { Asset } from "@/components/engine/db";

const CAPTIONS_NAME_REGEX = /^Captions (\d+)$/;

function nextCaptionsName(all: ReadonlyArray<Asset>): string {
  let max = 0;
  for (const asset of all) {
    const match = asset.name.match(CAPTIONS_NAME_REGEX);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `Captions ${max + 1}`;
}

export function hasAudioSources(world: EngineWorld, sceneEid: number): boolean {
  const c = world.components;
  for (const eid of getEntityTree(world, sceneEid)) {
    if (hasComponent(world, eid, c.Muted)) continue;
    if (hasComponent(world, eid, c.Audio) && c.AssetId[eid]) return true;
    if (hasComponent(world, eid, c.Paint) && c.Paint[eid] === PaintType.VIDEO && c.AssetId[eid]) {
      return true;
    }
  }
  return false;
}

/**
 * Fingerprint of everything that shapes a scene's audible mix — source
 * content, placement, source offset, rate, and gain. Volume fades and audio
 * transitions are not captured; they don't change the spoken words.
 */
export function sceneAudioFingerprint(world: EngineWorld, sceneEid: number, seed?: number): string {
  const c = world.components;
  const entries: string[] = [];

  for (const eid of getEntityTree(world, sceneEid)) {
    if (hasComponent(world, eid, c.Muted)) continue;

    let audioEid: number | null = null;

    if (c.Paint[eid] === PaintType.VIDEO) {
      audioEid = getParentEntity(world, eid) ?? null;
    }

    if (!hasComponent(world, eid, c.Audio)) {
      audioEid = eid;
    }


    const asset = world.assets.get(c.AssetId[eid] ?? "");
    if (audioEid === null || !asset) continue;

    entries.push([
      asset.hash,
      c.Computed.start[audioEid] ?? 0,
      c.Computed.end[audioEid] ?? 0,
      c.Computed.delay[audioEid] ?? 0,
      c.PlaybackRate[audioEid] ?? 1,
      c.Volume[audioEid] ?? 0,
    ].join(":"));
  }

  const mix = entries.sort().join("|");
  return `v1:${fnv1a(seed === undefined ? mix : `${mix}#seed=${seed}`)}`;
}

function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

export function transcriptTrim(transcript: Transcript): { start: number; end: number } {
  const firstWord = transcript.at(0)?.words.at(0);
  const lastWord = transcript.at(-1)?.words.at(-1);
  return { start: secondsToFrames(firstWord?.start), end: secondsToFrames(lastWord?.end) };
}

export type TranscribeStatus = "encoding" | "uploading" | "transcribing";

/**
 * Encodes a scene's audio, transcribes it, and stores the transcript as an asset.
 */
export async function transcribeScene(
  engine: Engine,
  sceneEid: number,
  onStatus?: (status: TranscribeStatus) => void,
  seed?: number,
) {
  const world = engine.world;
  const c = world.components;

  if (!entityExists(world, sceneEid) || !hasComponent(world, sceneEid, c.Scene)) {
    throw new Error(`Node ${sceneEid} is not a scene.`);
  }
  if (!hasAudioSources(world, sceneEid)) {
    throw new Error("No audio found. Add an audio or video clip to the scene to generate captions.");
  }

  const generationKey = sceneAudioFingerprint(world, sceneEid, seed);
  const cached = Array.from(world.assets.values())
    .find(a => a.type === "TRANSCRIPT" && a.generationKey === generationKey);

  if (cached) {
    const transcript = await resolveTranscript(cached);
    if (transcript.length) {
      return {
        asset: { id: cached.id, name: cached.name, type: cached.type },
        trim: transcriptTrim(transcript),
      };
    }
  }

  onStatus?.("encoding");
  engine.stop();
  let result;
  try {
    const encoder = await createEncoder(world, {
      scene: sceneEid,
      video: { enabled: false },
      audio: { enabled: true, codec: "opus", sampleRate: 24000 },
      format: "ogg",
    });
    result = await encoder.render();
  } finally {
    engine.start();
  }

  if (result.type !== "success" || !result.data) {
    throw new Error("Failed to encode audio");
  }

  onStatus?.("transcribing");
  // Local whisper.cpp in the main process; the mixed audio never leaves the machine.
  const transcript = await transcribeBytes(new Uint8Array(await result.data.arrayBuffer()), ".ogg");

  assert(transcript.length, "No speech detected. The audio does not appear to contain recognizable speech.");
  assert(transcript.every((s) => s.words.length > 0), "No speech detected. The audio does not appear to contain recognizable speech.");

  const name = nextCaptionsName(Array.from(world.assets.values()));
  const blob = new Blob([JSON.stringify(transcript)], { type: "application/json" });
  const file = new File([blob], `${name}.json`, { type: "application/json" });
  const asset = await loadAsset(world, file, { name, generationKey });

  assert(asset.type === "TRANSCRIPT", "Expected a transcript asset");

  return { asset: { id: asset.id, name: asset.name, type: asset.type }, trim: transcriptTrim(transcript) };
}
