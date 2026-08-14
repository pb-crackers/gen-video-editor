/**
 * The contract.
 *
 * Ported from directors-cut's `src/schema.ts`, which is the source of truth for
 * what an edit *is*: a list of segments, each with a stable id, a time range,
 * and a graphic. A config written against that schema means the same thing here
 * as it does there — that is the whole point of copying the shape rather than
 * inventing one.
 *
 * **Deliberately partial.** directors-cut's schema is ~1,300 lines describing
 * fifteen canvas kinds, window chromes, surfaces, anchors and annotations. Most
 * of those describe primitives this repo has no renderer for, and a schema that
 * accepts a config nothing can draw is worse than no schema at all. So the
 * envelope is faithful, the ported kinds are real, and every other kind is declared in
 * `PLANNED_KINDS` and refused by name until someone ports it.
 *
 * The one intentional divergence from upstream: `zColor` from
 * `@remotion/zod-types` is a plain `z.string()` here. It only ever existed to
 * give Remotion Studio a colour picker, and importing it would drag the Remotion
 * licence into a fork that exists partly to be out from under it.
 */
import { z } from "zod";

import { FORMATS, type Format, type FormatName } from "./format";

/** The format names a config may name, for zod's enum. */
export const FORMAT_NAMES = Object.keys(FORMATS) as [FormatName, ...FormatName[]];

/** Same shape as upstream: lowercase, hyphenated, path-safe, max 60. */
export const SEGMENT_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Canvas kinds this repo can actually draw. */
export const IMPLEMENTED_KINDS = ["none", "stat", "title", "bullets"] as const;

/**
 * Kinds directors-cut has and this repo does not, yet. Listed so a config that
 * uses one fails with a sentence naming it rather than rendering an empty frame.
 */
export const PLANNED_KINDS = [
  "code", "diagram", "sequence", "compare",
  "repo", "dashboard", "landing", "stack", "image", "screencast", "custom",
] as const;

const BaseCanvas = {
  /** A small heading above the content. */
  eyebrow: z.string().optional(),
};

export const CanvasSchema = z.discriminatedUnion("kind", [
  /** Draws nothing. The default, so a segment can exist before its graphic does. */
  z.object({ kind: z.literal("none") }),

  /** One big number. The highest-retention graphic there is. */
  z.object({
    ...BaseCanvas,
    kind: z.literal("stat"),
    value: z.string(),
    label: z.string(),
    sublabel: z.string().optional(),
    /** Count up from zero. Only works when `value` starts with a number. */
    countUp: z.boolean().default(true),
  }),
  /** A statement card — the hook, and section breaks. */
  z.object({
    ...BaseCanvas,
    kind: z.literal("title"),
    title: z.string(),
    subtitle: z.string().optional(),
  }),

  /** Up to four lines that assemble as they are spoken. */
  z.object({
    ...BaseCanvas,
    kind: z.literal("bullets"),
    title: z.string().optional(),
    items: z
      .array(
        z.object({
          text: z.string(),
          /**
           * When this line should appear, reel-absolute. Copy it off the
           * transcript entry for the word it belongs to; omit it and the lines
           * spread evenly. A list on a timer fights the voice.
           */
          atMs: z.number().optional(),
        }),
      )
      .min(1)
      .max(4),
  }),
]);

export type CanvasContent = z.infer<typeof CanvasSchema>;
export type CanvasKind = CanvasContent["kind"];

/**
 * Where the graphic sits relative to the speaker.
 *
 * Only `overlay` is implemented here. `float` and `backdrop` need a speaker
 * matte, and this engine drops video alpha — see docs/matte.md.
 */
export const LAYOUTS = ["overlay"] as const;
export type Layout = (typeof LAYOUTS)[number];

export const SegmentSchema = z.object({
  /**
   * Stable, unique within the film, and **the address**.
   *
   * Everything downstream keys off this: the compiler stamps it into the node's
   * name, and the differ resolves it back to a live entity. It must never be
   * positional — the engine's own `MountPath` is a creation ordinal, so
   * inserting a graphic renumbers every one after it. An id survives insertion,
   * reordering and re-mounting; an ordinal does not.
   */
  id: z.string().regex(SEGMENT_ID_PATTERN, "must be lowercase letters, digits and hyphens"),
  startMs: z.number().min(0),
  endMs: z.number().min(0),
  /**
   * The words spoken here. Never rendered — it exists so the config is
   * reviewable beside the transcript.
   */
  note: z.string().optional(),
  layout: z.enum(LAYOUTS).default("overlay"),
  canvas: CanvasSchema.default({ kind: "none" }),
});

export type Segment = z.infer<typeof SegmentSchema>;

export const ThemeSchema = z.object({
  accent: z.string().default("#FFB627"),
  ink: z.string().default("#FFFFFF"),
  card: z.string().default("rgba(12,14,18,.86)"),
  muted: z.string().default("rgba(255,255,255,.62)"),
});
export type Theme = z.infer<typeof ThemeSchema>;

export const ReelSchema = z.object({
  title: z.string().default("Untitled reel"),
  /** Asset id of the speaker footage, as `dapi asset add` reports it. */
  source: z.string(),
  /**
   * The frame. `portrait` is a reel, `landscape` is a YouTube video.
   *
   * Dimensions are **derived** from this rather than written alongside it —
   * width and height that disagree with the format are how a graphic ends up
   * positioned for the wrong frame while every number in the file looks
   * plausible. See `film/format.ts`.
   */
  format: z.enum(FORMAT_NAMES).default("portrait"),
  /**
   * Never used, only checked.
   *
   * Kept in the schema so a config carrying dimensions — from directors-cut, or
   * from an older version of this one — fails with a sentence instead of having
   * them silently ignored. A file saying 1920×1080 while rendering portrait is
   * the precise failure the `format` field exists to remove, and dropping these
   * keys quietly would reintroduce it.
   */
  width: z.number().optional(),
  height: z.number().optional(),
  segments: z.array(SegmentSchema).default([]),
  theme: ThemeSchema.default(ThemeSchema.parse({})),
});

export type Reel = z.infer<typeof ReelSchema>;

/** The resolved frame for a parsed reel. Dimensions come from here, not the config. */
export function reelFormat(reel: Reel): Format {
  return FORMATS[reel.format];
}

/**
 * Parse and check the things zod cannot express on its own.
 *
 * The upstream equivalent is `preflight()`, and it exists for the same reason:
 * a config should fail with a sentence naming the segment, before anything is
 * built, rather than render something wrong.
 */
export function parseReel(input: unknown): Reel {
  const parsed = ReelSchema.parse(input);

  // Dimensions are derived from the format. If a config also states them, they
  // have to agree — a mismatch means someone believes something about the frame
  // that is not true, and every graphic would be placed for the other one.
  const frame = FORMATS[parsed.format];
  const stated = { width: parsed.width, height: parsed.height };
  for (const axis of ["width", "height"] as const) {
    const value = stated[axis];
    if (value !== undefined && value !== frame[axis]) {
      throw new Error(
        `Reel says ${axis} ${value} but format "${parsed.format}" is ` +
          `${frame.width}×${frame.height}. Drop the ${axis} or change the format — ` +
          `dimensions are derived from the format, not set beside it.`,
      );
    }
  }

  const seen = new Set<string>();
  for (const seg of parsed.segments) {
    if (seen.has(seg.id)) {
      throw new Error(`Duplicate segment id "${seg.id}". Ids are addresses and must be unique.`);
    }
    seen.add(seg.id);

    if (seg.endMs <= seg.startMs) {
      throw new Error(`Segment "${seg.id}" ends at ${seg.endMs}ms, at or before it starts (${seg.startMs}ms).`);
    }
  }

  return parsed;
}

/**
 * A kind that parsed but cannot be drawn yet. Separate from a parse failure so
 * the message can say "not ported" rather than "invalid".
 */
export function assertRenderable(kind: string, segmentId: string): void {
  if ((IMPLEMENTED_KINDS as readonly string[]).includes(kind)) return;
  const planned = (PLANNED_KINDS as readonly string[]).includes(kind);
  throw new Error(
    planned
      ? `Segment "${segmentId}" uses canvas kind "${kind}", which exists in directors-cut but is not ported here yet. Implemented: ${IMPLEMENTED_KINDS.join(", ")}.`
      : `Segment "${segmentId}" uses unknown canvas kind "${kind}".`,
  );
}
