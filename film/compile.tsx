/**
 * scene config → mounted composition.
 *
 * The edit is the JSON. This turns it into JSX, and nothing else is allowed to
 * decide what a graphic looks like — that is what makes two films with the same
 * config produce the same frames.
 *
 * ## The addressing rule
 *
 * Every segment becomes exactly one node, named `seg:<id>`. That name is the
 * contract between the config and the live document: a differ that wants to
 * change segment "hours-total" resolves it with
 *
 *     dapi node grep "seg:hours-total" -k Name
 *
 * and patches the id it gets back. It must never address by position. The
 * engine stamps each entity with a `MountPath`, but that path is a *creation
 * ordinal* — inserting one graphic renumbers every graphic after it, so an
 * adopt-by-path re-mount would rebind "hours-total" to its neighbour. Ids
 * survive insertion and reordering; ordinals do not. This is the bug the whole
 * surgical-edit design exists to avoid, so it is stated here rather than
 * discovered later.
 */
import { For } from "solid-js";

import { assertRenderable, type Reel, type Segment } from "./schema";
import { Stat } from "./primitives/stat";
import { Title } from "./primitives/title";
import { Bullets } from "./primitives/bullets";

/** The name every segment node carries. The differ's only handle on it. */
export const segmentNodeName = (id: string) => `seg:${id}`;

const ms = (v: number) => v / 1000;

function SegmentGraphic(props: { segment: Segment; reel: Reel }) {
  const seg = () => props.segment;
  const canvas = () => seg().canvas;

  // Fail by name, before anything draws. A frame that is silently empty is a
  // worse outcome than a mount that refuses and says which segment.
  assertRenderable(canvas().kind, seg().id);

  const start = () => ms(seg().startMs);
  const end = () => ms(seg().endMs);

  return (
    <>
      {canvas().kind === "title" ? (
        <Title
          name={segmentNodeName(seg().id)}
          start={start()}
          end={end()}
          theme={props.reel.theme}
          {...(canvas() as Extract<Segment["canvas"], { kind: "title" }>)}
        />
      ) : null}

      {canvas().kind === "bullets" ? (
        <Bullets
          name={segmentNodeName(seg().id)}
          start={start()}
          end={end()}
          theme={props.reel.theme}
          {...(canvas() as Extract<Segment["canvas"], { kind: "bullets" }>)}
        />
      ) : null}

      {canvas().kind === "stat" ? (
        <Stat
          name={segmentNodeName(seg().id)}
          start={start()}
          end={end()}
          theme={props.reel.theme}
          {...(canvas() as Extract<Segment["canvas"], { kind: "stat" }>)}
        />
      ) : null}
    </>
  );
}

/**
 * Build the whole composition from a parsed config.
 *
 * `scene` is derived from the reel title so re-mounting the same film replaces
 * its scene rather than accumulating scenes.
 */
export function compileReel(reel: Reel) {
  return (
    <rect
      scene={`film-${reel.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`}
      name={reel.title}
      width={reel.width}
      height={reel.height}
      fill="black"
    >
      <sequence name="A-roll">
        <video src={reel.source} width={reel.width} height={reel.height} start={0} />
      </sequence>

      <sequence name="Graphics">
        <For each={reel.segments}>
          {(segment) => <SegmentGraphic segment={segment} reel={reel} />}
        </For>
      </sequence>
    </rect>
  );
}
