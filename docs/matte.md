# Speaker matte — measured findings

Notes from benchmarking the speaker cut-out (the graphic-behind-the-speaker
effect) before implementing it in this fork. Every number here came from running
it on real footage; the point of writing them down is so the expensive parts do
not get re-derived.

Source under test: 1080×1920, 30 fps, HEVC — **BT.2020 primaries, HLG transfer,
10-bit**. That detail turns out to matter more than anything else below.

---

> ## ⚠ Fix the colour first
>
> **The footage is HDR and nothing in the chain tone-maps it.** BT.2020 values
> get rendered as BT.709, which reads as **washed-out, desaturated skin**. It is
> not a matte defect and no model change will fix it.
>
> ```sh
> ffmpeg -i in.mp4 \
>   -vf "zscale=t=linear:npl=100,tonemap=hable:desat=0,\
> zscale=p=bt709:t=bt709:m=bt709:r=tv,format=yuv420p" \
>   -color_primaries bt709 -color_trc bt709 -colorspace bt709 out.mp4
> ```
>
> Measured effect: **1.83× saturation restored**.
>
> This applies to **every matte already produced from HDR footage**, in this fork
> and in directors-cut — the segmentation helper decodes naively and the
> composite inherits it. It also degrades the matte itself, because Vision and
> RVM are both trained on sRGB and are currently being handed HDR-ish values.
>
> Tone-map before segmenting, not after. Everything downstream improves for free.

---

## 1. This engine drops video alpha

A VP9-alpha WebM (`alpha_mode=1`) composites as an **opaque black rectangle**.
The cut-out is correct; the alpha plane is discarded. VP9 carries alpha as a
secondary BlockAdditional stream and WebCodecs decodes only the primary one.

Verified alongside it:

| | result |
| --- | --- |
| VP9-alpha WebM | ❌ alpha dropped |
| PNG with alpha, including partial | ✅ exact, blends correctly |
| `<shaderPaint>` | one texture input only — a second video cannot be sampled |
| image-sequence decoder | accepts `png/webp/avif` via `createImageBitmap` |

So there are two ways to carry a matte here: an **image sequence with alpha**
(works today, costs disk), or **teaching `decoders/video.ts` to demux and decode
the alpha stream** (the real fix, and the reason to own the engine).

The single-texture limit on `shaderPaint` rules out the obvious alternative of
pairing a colour video with a separate luma matte.

## 2. The colour was wrong, and it is wrong upstream too

Nothing in the chain tone-maps the HDR source. BT.2020 values rendered as BT.709
read **desaturated** — this is the washed-out skin, not a matte defect.

Correcting it (`zscale=t=linear,tonemap=hable,zscale=p=bt709:t=bt709:m=bt709`)
restores **1.83× the saturation**.

Two consequences worth stating plainly:

- Every matte produced from HDR footage so far carries this.
- Both Vision and RVM are trained on sRGB, so feeding them HDR-ish values
  degrades the matte itself, not just its colour.

Tone-map first. Everything downstream gets better for free.

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
