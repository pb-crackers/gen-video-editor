# Primitives

A primitive is a graphic whose **content** is authored and whose **treatment** is
not. The caller passes what to say and when; type scale, colour, layout, easing
and entrance belong to the primitive.

Ported from directors-cut, keeping its authoring contract verbatim so a scene
config written for one renderer means the same thing here.

```sh
dapi mount examples/primitives/demo.tsx
```

| Primitive | Contract |
| --- | --- |
| [stat.tsx](stat.tsx) | `value`, `label`, `sublabel?`, `countUp?`, `eyebrow?` |

## Why bother

Improvising a graphic is fine once. It is not fine twice: nothing carries
forward, and the second one drifts from the first.

`stat` is the evidence. Written by hand for `"~10 hours"` it looked correct, and
it broke immediately on `"1.4M downloads"` — the value shoved the label off the
card. Fixing it once, inside the primitive, fixed it for every stat anyone
writes afterwards. That fitting rule is the thing improvisation cannot
accumulate.

What primitives buy: consistency across films, and taste that compounds.
What they do not buy: a better first graphic.

They also make a graphic **data** — one line an agent emits, a differ diffs, and
validation can reject before anything renders.

Keep an escape hatch for the one-off a film genuinely needs; not every graphic
should become a primitive. Promote one when a human has looked at it and wants
it again.
