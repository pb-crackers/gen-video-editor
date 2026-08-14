# Plan

What to build, in order, one at a time. Each task says what it is, why it is
here and not somewhere else, and what "done" means — a thing you can check, not
a feeling.

The goal this serves: **an agent that directs videos, for reels and for YouTube,
running entirely on this machine for free.** Everything below is either on that
path or it is not in this document.

Background: [HANDOFF.md](../HANDOFF.md) for state and traps, [matte.md](matte.md)
for the measured matte findings, [film/README.md](../film/README.md) for the
addressing rule.

---

## 1. The matte

**Graphics behind the speaker.** The effect the whole thing is for.

First because it was both the highest value and the biggest unknown. That paid
off in an unexpected direction: two of the three sub-tasks turned out to be
much smaller than the notes claimed, because neither had been measured against
*this* engine — only against the Remotion pipeline the findings came from.
Check the premise on the thing in front of you before building for it.

### 1a. Decode the alpha — ✅ done, output path

`mediabunny` already demuxes and merges VP9 alpha side data; nothing was asking
it to. `VideoExporter` now passes `alpha: true` to `CanvasSink`, gated on
`track.canBeTransparent()`. Verified: a matte cuts out cleanly over a striped
backdrop, and opaque video renders unchanged.

### 1b. Alpha in the live preview — ⬜ open

`render` and `capture` are fixed. The editor's on-screen preview is a different
decoder (`VideoBuffer`, hand-rolled for scrub performance) and still shows the
colour plane opaque, so a matte looks wrong on screen and correct in the export.

Needs: a second `VideoDecoder` fed from `packet.alphaToEncodedVideoChunk()`,
frames paired by timestamp, and a merge written by hand — mediabunny's
`ColorAlphaMerger` is not publicly exported. Also add the missing `clearRect` in
`VideoBuffer.toBitmap()`, which would otherwise leave the previous frame showing
through transparent pixels.

Lower priority than it looks: the agent's loop is `mount` → `capture`, and
`capture` is on the fixed path.

### 1c. Tone-map the render path — ✅ not needed, measured

**The engine already tone-maps HLG correctly.** Measured three ways on the
camera original at t=16s: naive `ffmpeg` 0.2129 saturation, correct tone-map
0.3330, this engine **0.3483** — within 5% of correct and 1.64× the naive
decode. Chrome applies the conversion from the track's colour metadata.

So there is nothing to build here, and tone-mapping the source before mounting
would be a *second* lossy pass over something already right. The rule still
holds for matte production (1d), where the segmentation helper decodes the file
itself and does get it wrong. Full numbers in `matte.md` § 1's box.

### 1d. Make the mattes — ✅ pipeline works, ⬜ not yet wired

`apps/desktop/src/matte.ts` produces a VP9+alpha WebM from a source clip:
tone-map → RVM resnet50 on CoreML → despill → encode, streamed over pipes with
nothing staged on disk. Verified end to end — a matte it generated was mounted
and composited by this engine, graphic behind the subject, clean edges.

**Speed: 2.30 fps end to end**, ~31 min for a 2-minute clip. Not the 5.42 fps of
§ 4b, which was inference alone; the VP9 encode dominates. See `matte.md`.

**Wired: `dapi media matte <id|path> -o out.webm [--start] [--frames]`.** CLI →
tRPC → renderer → IPC → main → RVM → ffmpeg. A local path is passed straight
through; an asset id is staged to disk first, because assets live in OPFS which
the main process cannot read, and main deletes the staging copy afterwards.
Reports `coverage` and warns when it is ~0, which is how you learn the range has
no speaker in it rather than wondering why the matte is empty.

(The earlier worry that `dapi` was an unmodifiable Homebrew binary was wrong:
`/opt/homebrew/bin/dapi` is a symlink into `apps/cli/dist`.)

**✅ Packaging.** `apps/desktop/scripts/stage-onnxruntime.mjs` stages the native
module — **259 MB → 38 MB**, current platform only, with macOS's two
byte-identical `libonnxruntime` copies deduped to a symlink. Verified by real
`InferenceSession.create` on the CoreML provider against the RVM model,
resolving only from the staged tree. It throws rather than staging nothing if
the platform has no binary, which is not hypothetical: **1.27.0 ships no
darwin/x64**, so an Intel build would otherwise have packaged a silently broken
`dapi media matte`.

Still unproven: no `electron-forge package` was run, so the landing spot inside
the bundle and whether notarization accepts these binaries are untested.

**✅ Tests.** `npm test` (vitest, config at `vitest.config.ts`, node-side code
only — `apps/web` needs a DOM and a GPU). 44 tests over the places where a wrong
answer is *silent*: the ffmpeg capability parser, `missingCapabilities`,
`frameReader`'s frame assembly and backpressure, `despill`, and the CLI's option
validation. All mutation-checked against the source rather than the assertions.

The reasoning that settled the architecture, kept because it is the expensive
part:

The remaining real work: producing the cut-outs.

**Runtime decided by measurement** (`matte.md` § 4b): **onnxruntime-node with
the CoreML provider, resnet50, ratio 0.4 — 5.42 fps.** The in-app route
(onnxruntime-web) was spiked first and rejected: its **WebGPU backend returns a
wrong matte** — 9% coverage where 43% is correct — and is no faster than wasm,
so the reason to prefer in-app evaporated. wasm is correct but slower than
node+CoreML on the better model.

Accepted cost: a native module that needs rebuilding against Electron's ABI.

Verified in the spike: the model contract is `src, r1i..r4i, downsample_ratio`
→ `fgr, pha, r1o..r4o`; `downsample_ratio` must be **rank 1, not a scalar**;
recurrent state seeds as `[1,1,1,1]` and the model grows it on frame one. Thread
`r*o` into the next frame's `r*i` — getting that wrong is invisible on a single
still, which is why the spike ran 24 consecutive frames.

The rest is already measured in `matte.md` § Recommended pipeline — do not
re-derive.

1. Tone-map HDR → BT.709 **before segmenting**. Not for colour — for the matte
   itself, because RVM and Vision are trained on sRGB.
2. RVM resnet50, `downsample_ratio` **0.4**. Not 1.0 — that is 5.6 hours for a
   2-minute video and buys 1.5 points of quality.
3. Composite from RVM's **`fgr`**, never the raw frame. The raw frame is what
   leaks the room in around the edge.
4. Despill.

If Vision is kept as a macOS fast path, use **median-5**, not an EMA. Half the
jitter for a sixth of the lag, and the jitter is impulsive so a median is the
right tool.

---

## 2. Format: portrait and landscape

**Reels and YouTube are both first-class, and the difference is not a width
parameter.** `frame.tsx` hardcodes `CARD = { x: 70, y: 200, width: 940 }`. The
type scale, caption placement and the whole graphic-band-over-speaker-band
geometry are portrait assumptions.

Second because it is blocking. Every primitive built before this decision bakes
in portrait and gets rewritten after it. Doing it now is cheap; doing it later
is a rewrite of the whole library.

Landscape is not a variant of portrait. It is a different frame: the speaker is
in a corner or absent, graphics run full-bleed, beats are longer, and structure
is chapters rather than a 90-second arc.

**Done when:** the same config renders correctly at 1080×1920 and 1920×1080,
with the primitives that exist, and no primitive reads a hardcoded frame
dimension.

Traps already known: `dapi node render` defaults to `resolution: 1080` meaning
**height**, so a vertical composition silently exports 608×1080 — pass `1920`.

---

## 3. Primitives: a floor, not a library

**The point is that the agent does not start from zero.** Not to reproduce
directors-cut's fifteen kinds.

Third because it is the first thing that is safe to build once format is
settled, and because the amount needed is smaller than it looks. Measured on a
real 26-segment film: `title` and `stat` alone cover 14 of 26 segments, and
`none` covers 7 more.

The kinds already here — `none`, `stat`, `title`, `bullets` — plus `code` and
`image` is a reasonable floor. Stop there and see what is actually missing in
use rather than porting a list.

**The more important half is `custom`.** From directors-cut's own director
skill:

> This is the general case, not the escape hatch. The fifteen canvas kinds are a
> jump start for tech content; a component is how everything else gets drawn.

A config names a component, the component is a file the agent writes. That is
how the agent designs whole screens, B-roll frames and animations without a
schema change for each one. This fork is a better host for it than Remotion was:
no bundle, no registry regeneration, and a broken component costs one mount
instead of every film's render.

**Done when:** an agent can write a new `.tsx`, name it from a config, mount it
and capture it — with no change to `schema.ts` and no build step.

Traps already known: `<html>` clips its content and shadow blur clipping at the
box edge leaves a visible seam — size boxes with headroom.

---

## 4. The skills

Last, because a skill describing capabilities that do not exist yet is fiction.

The split, which the investigation settled:

- **`editor`** — mechanics. How to drive `dapi` and this engine: probe,
  transcribe, grab, mount, capture, verify. Upstream's version is good and they
  maintain it. **Strip its § Compositing section** — those ten lines are house
  style, and they will fight the director skill's style.
- **`director`** — judgment. Telling the story, choosing the graphic, deciding
  when a graphic earns its place, matte discipline, reviewing your own output.

directors-cut's `reel-director/SKILL.md` is 1424 lines and roughly half of it is
Remotion mechanics that die in the port: `interpolate()` inline, the
`useCurrentFrame()` sequence-relative trap, `npm run scenes`, `Surface.test.ts`,
Remotion #659, the registry drift test.

The other half is about film and ports unchanged — when to reach for which
canvas, "a dashboard is built to read as a dashboard, not to be read", § Common
mistakes, § Reviewing your own graphics. That half is the asset, and it is the
part nobody would reconstruct from scratch.

**Do not port it as one file.** Split as you go.

**Done when:** an agent given a raw clip and a brief produces a cut with
graphics, without being told the mechanics in the prompt.

---

## Not on the path, but true

- **ffmpeg is found-or-installed, like whisper.** `apps/desktop/src/ffmpeg.ts`
  follows the same shape: env override, then discovery, then a Homebrew install
  the user agrees to. It installs **`ffmpeg-full`**, not `ffmpeg` — only the
  former depends on `zimg`, and without `zimg` there is no `zscale` and so no
  HDR tone-map. Discovery probes *capabilities*, not the presence of a binary
  named ffmpeg, and reports "wrong build" separately from "not installed".
- **genai is still hosted and paid.** Image, video and audio generation route
  through a paid service; transcription is the part that was made local. Not
  blocking — a talking-head cut needs none of it — but goal #1 is not fully met
  until this is either local or knowingly accepted.
- **`dapi mount` replaces a scene, it does not reconcile.** Human edits are lost
  on the next mount. The differ fixes this. It is deferred because it protects a
  loop that does not exist yet — nothing is being iteratively edited until the
  above works.
- **Never address by position.** `MountPath` is a creation ordinal; inserting a
  graphic renumbers everything after it. Address by `seg:<id>`. See
  [film/README.md](../film/README.md).
