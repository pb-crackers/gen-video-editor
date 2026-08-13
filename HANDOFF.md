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
- **`film/`** — the edit as a file. `schema.ts` (ported contract), `compile.tsx`
  (config → JSX), `primitives/` (`stat`, `title`, `bullets` on a shared
  `frame.tsx`), `demo.json`, `demo.tsx`.
- **`docs/matte.md`** — measured matte findings. Not implemented yet.

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

## Next

**[docs/plan.md](docs/plan.md) is the ordered task list.** In short:

1. **The matte** — graphics behind the speaker. The engine drops video alpha, so
   the effect is unavailable. Highest value and biggest unknown, so it goes first.
2. **Format** — portrait *and* landscape. Reels and YouTube are both first-class,
   and the difference is not a width parameter. Blocking: every primitive built
   before this bakes in portrait.
3. **Primitives** — a floor so the agent does not start from zero, not a port of
   directors-cut's fifteen kinds. `custom` (agent-authored components) matters
   more than the rest of the list combined.
4. **The skills** — `editor` keeps mechanics, `director` owns judgment. Last,
   because a skill describing capabilities that do not exist is fiction.

**The differ is deferred.** It is the right design, but it protects an iterative
edit loop that does not exist until the above works.

## Running it

```sh
npm run dev:desktop                  # main-process changes need a restart
dapi mount film/demo.tsx
dapi node grep "seg:hours-total" -k Name
```

Scratch work (comparison clips, benchmarks) is in `~/devlog-part3/`, outside the
repo.
