# film

The edit is a JSON file. This turns it into a mounted composition.

```sh
dapi mount film/demo.tsx
```

| File | What |
| --- | --- |
| [schema.ts](schema.ts) | The contract — ported from directors-cut, deliberately partial |
| [format.ts](format.ts) | Portrait and landscape: frame, safe area, card placement |
| [compile.tsx](compile.tsx) | config → JSX, and the addressing rule |
| [primitives/](primitives/) | The graphics a config can ask for |
| [primitives/frame.tsx](primitives/frame.tsx) | The shared card, type scale and entrance |
| [matte-check.tsx](matte-check.tsx) | Grade a speaker matte against the plate it ships on |
| [demo.json](demo.json) | A real config |
| [demo.tsx](demo.tsx) | `compileReel(parseReel(config))` — the whole mount |
| [demo-landscape.tsx](demo-landscape.tsx) | The same config, one field changed |

## Portrait and landscape

Reels and YouTube are both first-class. A config names a **format**, and the
dimensions come from it:

```json
{ "format": "landscape" }
```

**The card is the same size in both; only where it sits changes.** That is the
rule that made this cheap. Every type size in the library was tuned against a
940px card — `display` at 108, `value` at 112, the 0.62em advance `stat` uses to
decide when a long number steps down. Those are tuned to the *card*, not to the
frame. Keep the card and they all still hold; rescale it and every one has to be
re-reviewed against a moving target.

It stands up on its own terms too: both formats are 1080 on the short side, and
940 of 1920 leaves 980px of landscape frame for the speaker — the
graphic-left-speaker-right arrangement a landscape explainer wants anyway.

What actually differs is placement and keep-out. A reel is watched inside
platform chrome that eats the bottom third and a strip down the right; YouTube
gives most of that back and takes a bar at the bottom for player controls.

Measured when this landed: the portrait demo rendered **pixel-identical** before
and after formats existed. Adding landscape moved nothing.

**Dimensions are derived, never stated.** A config carrying `width`/`height`
that disagrees with its format is refused by name, because a file saying
1920×1080 while rendering portrait places every graphic for the wrong frame and
nothing about the result says so.

Writing a new primitive: take a `format` and call `cardBox(format, height)`.
Do not reach for `CARD` in `frame.tsx` — that constant is portrait, and `stat`
having quietly grown its own copy of those four numbers is what `format.ts`
exists to prevent.

## Why the id is the address

Every segment becomes one node named `seg:<id>`. That name is how anything
finds a graphic again:

```sh
dapi node grep "seg:hours-total" -k Name     # -> an entity id
dapi node patch --json '[{"id":19,"y":420}]' # -> changes that node, and nothing else
```

Measured on this composition: patching one node changed **one line** across the
whole document. Segments nobody named cannot change, because nothing addressed
them.

**Do not address by position.** The engine stamps each entity with a
`MountPath`, but that path is a creation ordinal. Inserting `typo-crash` ahead
of `hours-total` moved `hours-total` from path 5 to path 6 — and `typo-crash`
took slot 5, the address `hours-total` used to hold. An adopt-by-path re-mount
would have bound the name to the wrong graphic and produced exactly the silent
regression this design exists to prevent. Ids survive insertion and reordering;
ordinals do not.

## Why the schema is partial

Upstream is ~1,300 lines covering fifteen canvas kinds, window chromes,
surfaces, anchors and annotations. Most of that describes primitives this repo
cannot draw, and a schema that accepts a config nothing can render is worse than
no schema.

So: the envelope is faithful, `stat` is real, and everything else is listed in
`PLANNED_KINDS` and refused **by name**:

```
Segment "hook" uses canvas kind "diagram", which exists in directors-cut
but is not ported here yet. Implemented: none, stat.
```

Adding a kind is mechanical — a union member in `schema.ts`, a primitive, a
branch in `compile.tsx`. Implemented so far: `none`, `stat`, `title`, `bullets`.

## How the graphics are drawn

Primitives are `<html>` blocks: real markup and CSS, drawn into the canvas. That
is a deliberate choice for a **library the agent edits per video**. A model can
change padding or a font size in CSS reliably; asking it to keep imperative
canvas draw calls consistent after a size change is a far worse bet. It also
keeps the designs that were already reviewed, instead of redesigning them under
cover of porting.

`<html>` depends on an experimental Chromium flag the desktop app enables, so
graphics only draw where the app runs. That is a constraint on the **renderer**,
not on the product — a browser UI can still be the control surface and show
rendered frames.

The exception is anything that needs an actual line: diagram connectors,
sequence arrows, leader lines. There is no path or SVG element here, so those
go through `<surface>`, which hands you a canvas to draw into. The pure geometry
that computes where the lines go ports across unchanged.

## What `parseReel` catches before anything renders

- duplicate segment ids, because ids are addresses
- a segment that ends at or before it starts
- an id that is not path-safe

Same idea as upstream's `preflight()`: fail with a sentence naming the segment,
before a frame is drawn.

## Next

The differ. Given an old config and a new one, emit the minimal set of
`node patch` operations — computed by code, not by a model, so a change the
model made outside the segment it was allowed to touch is dropped rather than
trusted.
