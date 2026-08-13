# Speaker matte — measured findings

Notes from benchmarking the speaker cut-out (the graphic-behind-the-speaker
effect) before implementing it in this fork. Every number here came from running
it on real footage; the point of writing them down is so the expensive parts do
not get re-derived.

Source under test: 1080×1920, 30 fps, HEVC — **BT.2020 primaries, HLG transfer,
10-bit**. That detail turns out to matter more than anything else below.

---

> ## ⚠ Tone-map before you segment — but the renderer is already fine
>
> **Corrected 2026-08-13.** The original note here said nothing in the chain
> tone-maps the HDR source. That is true of a naive `ffmpeg` decode and it is
> **not** true of this engine, which was never actually measured before.
>
> Measured on the camera original (`hev1.2`, BT.2020/HLG, 10-bit, 1080×1920) at
> t=16s, mean HSV saturation over the frame:
>
> | decode | saturation | vs naive |
> | --- | --- | --- |
> | `ffmpeg`, no colour filters | 0.2129 | 1.00× |
> | `ffmpeg`, tone-mapped (below) | 0.3330 | 1.56× |
> | **this engine** (`dapi media grab`) | **0.3483** | **1.64×** |
>
> The engine lands within **5%** of the correct tone-map and nowhere near the
> naive decode. Chrome applies the HLG→SDR conversion from the track's colour
> metadata, so **A-roll renders correctly with no work**. The washed-out skin is
> a real artefact of decoding naively — it is just not what this renderer does.
>
> **Where it still bites: anything that decodes the source outside the engine.**
> The segmentation helper (Vision, RVM) reads the file itself, gets the naive
> result, and hands HDR-ish values to models trained on sRGB — degrading the
> matte, not just its colour. So the rule survives in its original form for the
> one step that motivated it:
>
> ```sh
> ffmpeg -i in.mp4 \
>   -vf "zscale=t=linear:npl=100,tonemap=hable:desat=0,\
> zscale=p=bt709:t=bt709:m=bt709:r=tv" \
>   -pix_fmt yuv420p \
>   -color_primaries bt709 -color_trc bt709 -colorspace bt709 out.mp4
> ```
>
> Tone-map before segmenting. Do **not** tone-map before mounting — the engine
> already did it, and doing it twice is a second lossy pass for nothing.
>
> Two notes on that command. The original carried `format=yuv420p` inside `-vf`;
> Remotion's bundled ffmpeg is built `--disable-filters` with an allow-list that
> has no `format`, so it is `-pix_fmt` here instead. And the earlier **1.83×**
> figure is the same effect measured on a different frame — direction and order
> of magnitude agree, the exact number does not transfer.

---

## 1. Video alpha — fixed on the output path

**Status: renders and captures keep alpha. The live preview does not, yet.**

The original finding was that a VP9-alpha WebM composited as an opaque
rectangle — the cut-out correct, the alpha plane discarded. The cause turned out
to be much smaller than "WebCodecs decodes only the primary stream":
`mediabunny` already demuxes VP9 alpha side data and already merges it. Nothing
was asking it to.

Measured on `reel-04-matte.webm` (VP9, 1080×1920, 122s):

```
codec:             vp09.00.40.08.01.02.02.02.00
canBeTransparent:  true
packets checked:   30
with alpha:        30        <- every packet carries alpha side data
```

The engine has two decoder paths and they are not the same code:

| Path | Used by | Decoder | Alpha |
| --- | --- | --- | --- |
| `offline-video` | `dapi node render`, `dapi node capture` | `VideoExporter` → mediabunny `CanvasSink` | ✅ fixed |
| `realtime` | the editor's live preview | `VideoBuffer`, hand-rolled `VideoDecoder` + atlas cache | ❌ still opaque |

The fix on the output path is `new CanvasSink(track, { alpha: true })`, gated on
`await track.canBeTransparent()` so an opaque source does not pay for a second
decode per frame. Verified end to end: a matte composited over a striped
backdrop cuts out cleanly at hair, an earbud cable and a bare arm, and an opaque
video renders unchanged.

**The preview is still to do**, and it is more work than the exporter was.
`VideoBuffer` is hand-rolled for scrub performance, so it needs a second
`VideoDecoder` fed from `packet.alphaToEncodedVideoChunk()`, frames paired by
timestamp, and a merge. Note that mediabunny's `ColorAlphaMerger` is **not
publicly exported**, so the merge has to be written here. `FrameCache` is
already alpha-safe — both its canvases default to `alpha: true` and it clears
before every draw — but `VideoBuffer.toBitmap()` draws to its display canvas
**without** a `clearRect`, which would leave the previous frame showing through
transparent pixels. Fix that in the same pass.

Still true, and still worth knowing:

| | result |
| --- | --- |
| PNG with alpha, including partial | ✅ exact, blends correctly |
| `<shaderPaint>` | one texture input only — a second video cannot be sampled |
| image-sequence decoder | accepts `png/webp/avif` via `createImageBitmap` |

The single-texture limit on `shaderPaint` still rules out pairing a colour video
with a separate luma matte, and the image sequence is still the fallback if a
codec ever turns up that mediabunny cannot demux.

## 2. The colour, and who actually gets it wrong

The source is BT.2020 primaries / HLG transfer / 10-bit. Decoded naively it
reads **desaturated and milky** — the washed-out skin. Decoded with the colour
metadata honoured, it reads correctly.

**This engine honours it** (measured; see the box above). What does not:

- **The segmentation helper.** Vision and RVM read the source file directly.
  Both are trained on sRGB, so naive HDR-ish values degrade the matte itself,
  not just its colour. Tone-map before segmenting.
- **Any `ffmpeg` command without explicit colour filters**, which is how the
  original finding was produced.

So the fix moved rather than disappeared: it belongs in matte production, not in
the render path. Tone-mapping the source before mounting would now be a second
lossy pass over something already correct.

## 3. Temporal filtering: median beats EMA

Apple's `VNGeneratePersonSegmentationRequest` is per-frame with no temporal
model, so the boundary shimmers. An EMA is the obvious fix and the wrong one.

Measured over four 48-frame windows, on the edge band:

| filter | jitter removed | drift (lag) | removed per unit lag |
| --- | --- | --- | --- |
| EMA 0.35 | 68.5% | 2.561 | 26.7 |
| median-3 | 32.5% | 0.239 | 136.1 |
| **median-5** | **53.4%** | **0.403** | **132.6** |
| median-3 + EMA 0.5 | 65.7% | 1.550 | 42.4 |

`drift` is mean distance from the raw mask — it *is* the lag you see when the
speaker moves.

The jitter is **impulsive**: pixels flipping for a single frame. A median rejects
an outlier outright; an EMA averages it in and then drags that average behind the
motion. That is why the artefact is worst exactly when the subject moves.

**Use median-5.** Half the jitter for a sixth of the lag.

A guided filter (colour frame as edge guide) was also tried and **does not
help** — 5–13% jitter removed for the same drift EMA costs. The set has almost no
contrast at the boundary for it to snap to. It would work against a green screen.

## 4. RVM: better edges, not better stability

RobustVideoMatting, ONNX, run with CoreML.

| | soft pixels | coverage wobble | pixels flipping |
| --- | --- | --- | --- |
| Vision + median-5 | 0.7% | **0.25%** | **246** |
| RVM mobilenetv3 | **3.8%** | 0.29% | 321 |

RVM is **not** a temporal-stability win — Vision + median-5 matches or beats it.
What RVM gives is 4–5× more soft pixels: real hair and edge transitions instead
of a traced outline, plus no post-filter to tune, plus it runs anywhere.

Speed at 1080×1920 on CoreML, and cost for a 2-minute video:

| model / ratio | fps | 2 min |
| --- | --- | --- |
| mobilenetv3, 0.25 | 8.2 | 7.5 min |
| resnet50, 0.25 | 4.7 | 13 min |
| resnet50, 0.4 | 3.5 | 17 min |
| resnet50, 0.6 | 1.5 | 40 min |
| resnet50, 1.0 | 0.18 | **5.6 hours** |

`downsample_ratio` barely moves quality: cable pixels kept were 96.7% at 0.25 and
98.2% at 1.0. **Use 0.4.** Paying hours for 1.5 points is not a trade.

Composite from RVM's **`fgr`** output, never the raw frame — `fgr` is the
decontaminated foreground with background colour removed from semi-transparent
pixels. Using the raw frame is what leaks the room in around the edge.

## 5. What is left, and it is not the algorithm

Two artefacts survive all of the above, and neither is fixable by a better model:

- **The hand is motion-blurred in the source.** No matte recovers detail that was
  never captured. Compositing a blurred hand over a sharp background is what
  reads as a matte failure. Faster shutter.
- **Green spill** from the room's LED wash bleeds into edge pixels and shows as a
  cyan fringe against a dark plate. A despill pass fixes it (pull green back
  where it exceeds the mean of red and blue); killing the light fixes it better.

Also worth knowing: a harsh, saturated test backdrop exaggerates every one of
these. Against the dark textured plate the effect actually uses, the same matte
reads cleanly. Judge mattes against the backdrop they will ship on.

## Recommended pipeline

1. Tone-map HDR → BT.709 **first**.
2. RVM resnet50, `downsample_ratio` 0.4, composite from `fgr`.
3. Despill.
4. Carry as an alpha image sequence until the decoder learns VP9 alpha.

If Vision is kept as the macOS fast path, swap its EMA for median-5.
