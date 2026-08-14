/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { PatchProps } from "@diffusionstudio/jsx";

// Wire-level channel for the CLI handshake. Each CLI command hosts a
// short-lived WebSocket server; main's only job is to relay the connect
// info to the renderer, which then dials the CLI directly. Main never sees
// request payloads.
export const CLI_WIRE = {
  CONNECT: "cli:connect",
} as const;

// Sent by the CLI to main over the unix socket, relayed verbatim to the
// renderer. The token guards the loopback WebSocket server against other
// local processes racing to connect first.
export type CliHandshake = { port: number; token: string };

export type CliHandshakeReply = { ok: true } | { ok: false; error: string };

// One tRPC request/reply pair per WebSocket connection. `path` is the
// dot-joined procedure path in the renderer's router (e.g. "media.frame");
// procedure inputs and outputs are typed end-to-end via the AppRouter type,
// so the wire envelope stays untyped.
export type CliRequest = {
  path: string;
  input: unknown;
};

export type CliReply =
  | { ok: true; data: unknown }
  | { ok: false; error: string };

export type NodeRef = { id: number; name: string; type: string };

export type EntityRecord = { id: string; eid: number } & Record<string, unknown>;


export type NodeTree = NodeRef & {
  description: string;
  children?: NodeTree[];       // child nodes (masks listed separately)
  masks?: NodeTree[];
  paints?: NodeTree[];         // fills
  strokes?: NodeTree[];
  shadows?: NodeTree[];
  effects?: NodeTree[];
  colorStops?: NodeTree[];     // on gradient paints
  textRanges?: NodeTree[];     // on text nodes
  keyframeTracks?: NodeTree[]; // keyframes nest beneath their track
  keyframes?: NodeTree[];
  animations?: NodeTree[];
};

export type NodeGrepRequest = {
  pattern: string;
  ignoreCase?: boolean;
  id?: number;          // scope to this entity's subtree; omitted = the whole document
  types?: string[];     // only match entities of these node types
  components?: string[]; // restrict matching to these components
};

export type NodeGrepMatch = { component: string; value: string };

export type NodeGrepResult = NodeRef & { matches: NodeGrepMatch[] };

export type NodeDeleteResult = { id: number };

export type MountRequest = {
  code: string;
};

export type NodeInsertRequest = {
  code: string;
  parentId: number;
  index?: number;
};

export type NodePatch = { id: number } & PatchProps;

export type NodePatchResult = { id: number };

export type NodeDuplicateResult = { sourceId: number; newId: number };

export type EncoderConfigInput = {
  format?: "mp4" | "webm" | "ogg" | "mov";
  video?: {
    codec?: "avc" | "hevc" | "vp9" | "av1" | "vp8";
    enabled?: boolean;
    bitrate?: number;
    fps?: number;
    resolution?: number;
  };
  audio?: {
    enabled?: boolean;
    codec?: "aac" | "opus";
    bitrate?: number;
    sampleRate?: number;
    numberOfChannels?: number;
  };
  trim?: { end?: number };  // seconds; caps the encode end
};

export type NodeRenderRequest = { id?: number; output: string; config?: EncoderConfigInput };
export type NodeRenderResult = { path: string };

export type AssetRef = { id: string } | { path: string };

export type MediaProbeRequest = AssetRef;

export type FrameQuality = "small" | "medium" | "large" | "fullres";
export type MediaFrameRequest = AssetRef & {
  times?: number[];
  count?: number;
  start?: number;
  end?: number;
  quality?: FrameQuality;
  auto?: boolean;
  combine?: boolean;
  perSheet?: number;
};

/** Beyond this the cells get too small to be worth the tokens; use `filmstrip`. */
export const MAX_FRAMES_PER_SHEET = 12;

/**
 * One written image: a single frame stamped with its timecode, or a contact
 * sheet stamped with the span it covers (`0f-08s10f`).
 */
export type TimecodedImage = { timecode: string; base64: string };

export type MediaFrameResult = TimecodedImage[];

export type NodeCaptureRequest = {
  id: number;
  frames?: number[];
  combine?: boolean;
  perSheet?: number;
};

export type NodeCaptureResult = TimecodedImage[];

export type MediaTranscribeRequest = AssetRef;
export type TranscriptWord = { text: string; start: number; end: number };
export type TranscriptSegment = { text: string; words: TranscriptWord[] };
export type MediaTranscribeResult = { segments: TranscriptSegment[] };

/**
 * Cut the speaker out of a clip. Slow and local: RobustVideoMatting runs in the
 * main process and a two-minute clip is roughly half an hour of inference, so
 * `startSec`/`maxFrames` exist to matte one beat rather than a whole file.
 */
export type MediaMatteRequest = AssetRef & {
  /** Absolute path to write the VP9+alpha WebM to. */
  output: string;
  model?: "resnet50" | "mobilenetv3";
  ratio?: number;
  despill?: number;
  startSec?: number;
  maxFrames?: number;
};
export type MediaMatteResult = {
  path: string;
  frames: number;
  seconds: number;
  width: number;
  height: number;
  fps: number;
  /**
   * Share of frames with a subject in them. Zero is a legitimate answer — the
   * footage may simply cut away — so it is reported rather than treated as an
   * error.
   */
  coverage: number;
};

export type MediaFilmstripRequest = AssetRef & { start?: number; end?: number; scale?: number };
export type MediaFilmstripResult = { base64: string };

export type MediaWaveformRequest = AssetRef & { start?: number; end?: number; scale?: number };
export type MediaWaveformResult = {
  base64: string;
  silences: Array<{ start: number; end: number }>;
};

export type MediaListenRequest = AssetRef & { prompt?: string; start?: number; end?: number; stripVideo?: boolean };
export type MediaListenResult = { result?: string; start?: number; end?: number };

export type GeneratedAsset = { id: string; name: string; type: string };

export type FolderInfo = { id: string; name: string; type: "folder" };

export type AssetTreeEntry = { id: string; name: string; type: string; children?: AssetTreeEntry[] };

export type AssetRecord = { id: string } & Record<string, unknown>;

export type AssetMoveResult = { id: string; folderId: string | null };

export type AssetsExportRequest = { ids: string[]; output: string; isDir: boolean };

export type AssetExportResult = { id: string; path: string };

export type FolderMoveResult = { id: string; parentId: string | null };

export type FolderDeleteResult = { id: string; deletedFolders: number; deletedAssets: number };

export type ModelsRequest = { type?: "image" | "video" | "audio" };

export type ModelInfo = {
  type: "image" | "video" | "audio";
  id: string;
  name: string;
  durations?: string[];
  aspectRatios?: string[];
  features?: Array<"start-frame" | "end-frame" | "audio">;
};

export type VoiceInfo = { id: string; label: string; description: string };

export type ProjectSummary = {
  id: string;
  name: string;
  createdAt: string;
  lastAccessedAt: string;
};

export type ScreenshotResult = { base64: string; width: number; height: number };

export type LogLevel = "debug" | "info" | "warning" | "error";

export type LogEntry = { ts: number; level: LogLevel; message: string; source: string };

export type LogsRequest = { tail?: number; level?: LogLevel };

