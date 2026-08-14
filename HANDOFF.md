# Handoff

Where this is, what was decided, and what bites. Read `docs/matte.md` and
`film/README.md` for the two areas with real depth.

## What this is

- Fork of `diffusionstudio/editor` → `github.com/pb-crackers/gen-video-editor`
- Working branch **`local-first`**, remote is `fork`. Upstream `origin` is theirs.
- Goal: the video editor behind **directors-cut** (`~/directors-cut`, Remotion),
  swapping Remotion's renderer for this engine while keeping directors-cut's
  schema, primitives and director skill — the parts that are actually the product.

## Done

- **Accounts, sign-in and billing removed.** `auth.tsx` keeps upstream's context
  shape but answers everything locally, which is why ~20 consumers compiled
  untouched. Login/checkout/upgrade/credits UI deleted. `.env` now optional.
- **Transcription is local.** whisper.cpp in the Electron main process
  (`apps/desktop/src/whisper.ts`): finds an existing install, otherwise asks and
  installs (brew, else cmake build). Both call sites converted —
  `dapi media transcribe` and `<captions>`. 122s of speech → 8.9s, no network.
- **`film/`** — the edit as a file. `schema.ts` (ported contract), `format.ts`
  (portrait + landscape), `compile.tsx` (config → JSX), `primitives/` (`stat`,
  `title`, `bullets` on a shared `frame.tsx`), `demo.json`, `demo.tsx`,
  `demo-landscape.tsx`.
- **Video alpha works on the output path.** mediabunny already demuxed VP9 alpha;
  nothing was asking it to. `VideoExporter` passes `alpha: true` to `CanvasSink`,
  gated on `track.canBeTransparent()`. Graphics now render behind the speaker.
- **Speaker mattes, locally.** `dapi media matte <id|path> -o out.webm
  [--start] [--frames]`. Tone-map → RVM resnet50 on CoreML → despill → VP9+alpha,
  streamed over pipes. ~2.5 fps, so a 2-minute clip is ~30 minutes. Reports
  `coverage` and warns at ~0, which is how you learn a range has no speaker in it.
- **ffmpeg is found-or-installed** (`apps/desktop/src/ffmpeg.ts`) — and probes
  *capabilities*, not the presence of a binary. See the traps below.
- **Packaging for the native module.** `apps/desktop/scripts/stage-onnxruntime.mjs`,
  259 MB → 38 MB. Not proven through a real signed build.
- **Both frames.** Portrait (reels) and landscape (YouTube); a config names a
  `format` and dimensions derive from it. Portrait renders pixel-identical to
  before formats existed.
- **Tests.** `npm test` — 81, vitest, node-side only. Aimed at what fails
  *silently*: the ffmpeg capability parser, frame assembly and its backpressure,
  despill, format geometry, and the schema's parse-time checks.
- **`docs/matte.md`** — measured matte findings, several of them corrections to
  earlier measurements. Read the ⚠ boxes.

## Decisions, with the reason

- **Segment `id` is the address.** Compiler stamps `seg:<id>` as the node name;
  find with `dapi node grep "seg:<id>" -k Name`, then patch that entity.
- **Primitives are `<html>`, not `<surface>`.** The agent edits these per video,
  and a model changes CSS reliably where it changes imperative draw calls badly.
  Also keeps already-reviewed designs. Cost: graphics only draw where the desktop
  app runs — a constraint on the renderer, not the product.
- **`<surface>` only for actual lines** (diagram connectors, leader lines). There
  is no path/SVG element. The geometry deciding where lines go ports unchanged.
- **Schema is deliberately partial.** Envelope faithful; unported kinds listed in
  `PLANNED_KINDS` and refused by name. A schema that accepts unrenderable configs
  is worse than none.
- **No `@remotion/*` dependencies**, incl. `install-whisper-cpp` and `zod-types` —
  the fork exists partly to be out from under that licence.

## Traps — all found the hard way

- **`MountPath` is a creation ordinal, not an identity.** Inserting a graphic
  renumbers everything after it (measured: `hours-total` 5 → 6, and the new
  graphic took slot 5). Never address by position.
- **`dapi mount` replaces a scene**, it does not reconcile. Human edits are lost
  on the next mount. Fixing this is engine work you now own.
- **Video alpha is fixed on the output path, not in the preview.** `render` and
  `capture` run `offline-video` → `VideoExporter` → mediabunny's `CanvasSink`,
  which now gets `alpha: true`. The editor's live preview runs `realtime` →
  `VideoBuffer`, which is hand-rolled and still drops alpha. A matte therefore
  looks wrong on screen and correct in the export. See `docs/matte.md` § 1.
- **Source footage is HDR (BT.2020/HLG), and this engine handles it correctly** —
  measured within 5% of a proper `ffmpeg` tone-map, 1.64× the naive decode. Do
  **not** pre-tone-map footage before mounting; that is a second lossy pass. The
  washed-out skin is real but belongs to naive decoders — including the
  segmentation helper, so tone-map before *segmenting*. See `docs/matte.md` § 1.
- **`whisper-cli` exits 0 when it cannot read the audio**, and its bundled
  miniaudio has no Opus support — feed it WAV, and check the output file exists.
- **`dapi node render` defaults to `resolution: 1080` meaning height**, so a
  vertical composition silently exports 608×1080. Pass `1920`.
- **Batch `dapi node capture -t a b c` races the decoder** — wrong video frames
  under correct overlays. Capture single timestamps when it matters.
- **`<html>` box clips its content**, and shadow blur clipping at the box edge
  leaves a visible seam across the frame. Size boxes with headroom.
- **`which ffmpeg` proves nothing.** Homebrew's plain `ffmpeg` omits libzimg, so
  it has no `zscale` and cannot tone-map HDR — while looking entirely healthy.
  `ffmpeg-full` is the formula that carries it. Install *that*.
- **`-auto-alt-ref 0` is mandatory when encoding VP9 with alpha.** libvpx's
  alt-ref frames and the alpha side-channel are mutually exclusive, and with
  alt-ref on the alpha is **silently dropped** — the encode succeeds and the
  matte is simply opaque.
- **The source is 34.989 fps, not 35.** Read frame rates as rationals and never
  round them, or a matte drifts against the footage it was cut from.
- **The footage is not one continuous shot.** It cuts to screen recordings. An
  empty matte over such a range is the correct answer, not a failure — hence
  `coverage`, and hence matting per segment rather than per file.
- **onnxruntime-node has no `default` export.** Bundled to CJS with the package
  external, `import ort from "onnxruntime-node"` typechecks perfectly and is
  `undefined` at runtime. Use named imports.
- **Streaming is not the same as bounded.** `frameReader` had no backpressure,
  so ffmpeg raced ahead of inference and 250 frames peaked at 6.25 GB. Fixed
  with a four-frame high-water mark; now flat at 2.88 GB. Tests guard it.
- **`film/` is only typechecked by `film/tsconfig.json`**, which is wired into
  `npm run check` *before* the `examples` one — `examples/06-three.tsx` fails
  on a missing `three` dependency (pre-existing, upstream's), and behind a `&&`
  the film check would never run.

## Next: the skills

**[docs/plan.md](docs/plan.md) is the ordered task list.** Tasks 1 (matte) and 2
(format) are done. **Task 4, the skills, is what to do next** — chosen ahead of
more primitives because the goal now is to get this usable on real videos and
find the kinks by using it.

The split, already settled by investigation:

- **`editor`** — mechanics. How to drive `dapi` and this engine: probe,
  transcribe, grab, mount, capture, verify. Upstream's copy is at
  `~/.claude/skills/editor/SKILL.md` (92 lines) and is good. **Strip its
  § Compositing section** — those ten lines are house style and will fight the
  director skill.
- **`director`** — judgement. Telling the story, choosing the graphic, when a
  graphic earns its place, matte discipline, reviewing your own output.

The source for `director` is directors-cut's `.claude/skills/reel-director/SKILL.md`
— **1,424 lines**, and roughly half of it dies in the port because it is Remotion
mechanics: `interpolate()` inline, the `useCurrentFrame()` sequence-relative
trap, `npm run scenes`, `Surface.test.ts`, Remotion #659, the registry drift
test. The other half is about film and ports unchanged — § Choosing a canvas,
§ Page mocks, "a dashboard is built to read as a dashboard, not to be read",
§ Common mistakes, § Reviewing your own graphics. That half is the asset and
nobody would reconstruct it from scratch. **Do not port it as one file.**

Two things to carry in from this fork that upstream's skill cannot know:

- `dapi media matte` exists, is slow, and should be run per segment.
- A config names a `format`; landscape is real now.

And one open design question worth deciding deliberately rather than inheriting:
**does the config stay a closed schema with `custom` as one member, or become
thin — timing, layout, component name — with nearly every graphic
agent-authored?** directors-cut hedged and kept both. The first keeps a differ
meaningful; the second is where "the agent designs whole screens" actually
leads.

**Deferred, still right:** the differ (old config vs new → minimal `node patch`
set). It protects an iterative edit loop that barely exists yet.

**Also open:** live-preview alpha (`docs/plan.md` § 1b) — the app shows mattes
opaque on screen while exporting them correctly. Cosmetic for the agent loop,
confusing for a human.

## Running it

```sh
npm run dev:desktop                  # main-process changes need a restart
npm test                             # 81 tests
npm run check                        # tsc across workspaces + film
dapi mount film/demo.tsx             # portrait
dapi mount film/demo-landscape.tsx   # the same config, landscape
dapi node grep "seg:hours-total" -k Name
dapi media matte <id|path> -o out.webm --start 16 --frames 40
```

If the app will not start, port 5173 is usually still held by a previous dev
server: `lsof -ti:5173 | xargs kill -9`.

The RVM model lives at `~/Library/Application Support/Diffusion Studio/matte/models/`.
Scratch work (comparison clips, benchmarks) is in `~/devlog-part3/`, outside the
repo.
