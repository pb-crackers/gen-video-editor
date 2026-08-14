/**
 * The shared half of every primitive.
 *
 * directors-cut has two pieces every graphic leans on: `CanvasFrame` (the card
 * a graphic sits on, plus its eyebrow) and `entranceStyle` (the one rise-and-
 * fade, so nothing invents its own). Both are here, for the same reason: a
 * library where each member animates slightly differently is not a library.
 *
 * Primitives built on this only describe their content. Card, padding, palette,
 * entrance and timing come from here.
 */
import { createEffect } from "solid-js";
import { createStore } from "solid-js/store";
import { useTicker } from "@diffusionstudio/jsx";

import { CARD_STYLE, FORMATS, TYPE } from "../format";

export type Theme = { accent: string; ink: string; card: string; muted?: string };

export const DEFAULT_THEME: Required<Theme> = {
  accent: "#FFB627",
  ink: "#FFFFFF",
  card: "rgba(12,14,18,.86)",
  muted: "rgba(255,255,255,.62)",
};

/**
 * The type scale and card chrome now live in `../format`, because they are
 * shared across formats while position is not. Re-exported here so primitives
 * keep importing their look from one place.
 */
export { TYPE };

/**
 * The portrait card, kept as a named constant only so existing callers and
 * defaults keep working unchanged.
 *
 * **Do not reach for this in a new primitive.** It is portrait, and a primitive
 * that reads it is a primitive that renders in the wrong place on YouTube.
 * Take a `format` and call `cardBox(format, height)` instead — that is the
 * whole point of the format module, and `stat` having quietly grown its own
 * copy of these four numbers is what it exists to prevent.
 */
export const CARD = {
  x: FORMATS.portrait.card.x,
  y: FORMATS.portrait.card.y,
  width: FORMATS.portrait.card.width,
  radius: CARD_STYLE.radius,
  padding: CARD_STYLE.padding,
  hairline: CARD_STYLE.hairline,
};

export const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/**
 * The one entrance: rise, fade, and a blur that resolves inside the same window.
 * `t` is seconds since the element should begin.
 */
export function entrance(t: number, opts: { rise?: number; blur?: number; dur?: number } = {}) {
  const dur = opts.dur ?? 0.42;
  const k = clamp(t / dur, 0, 1);
  const e = 1 - Math.pow(1 - k, 3);
  const rise = opts.rise ?? 26;
  const blur = opts.blur ?? 8;
  return {
    opacity: e,
    transform: `translateY(${(1 - e) * rise}px)`,
    filter: e < 1 ? `blur(${(1 - e) * blur}px)` : "none",
  };
}

/**
 * Scene time, as a signal, offset by the node's own start. Every primitive
 * drives its animation from this rather than reading the ticker directly, so
 * "time since this graphic appeared" means the same thing everywhere.
 */
export function useLocalTime(start: () => number) {
  const { time } = useTicker();
  const [s, set] = createStore({ t: 0 });
  createEffect(() => set("t", time() - start()));
  return () => s.t;
}

/**
 * The card. Wraps a graphic's content, draws the optional eyebrow, and owns the
 * entrance so a primitive never animates its own container.
 */
export function CanvasFrame(props: {
  theme?: Theme;
  eyebrow?: string;
  t: number;
  children: unknown;
  align?: "left" | "center";
}) {
  const theme = () => ({ ...DEFAULT_THEME, ...(props.theme ?? {}) });
  const anim = () => entrance(props.t);

  return (
    <div
      style={{
        "box-sizing": "border-box",
        padding: CARD.padding,
        "font-family": "Inter, 'Helvetica Neue', Helvetica, sans-serif",
        color: theme().ink,
        background: theme().card,
        border: CARD.hairline,
        "border-radius": `${CARD.radius}px`,
        "text-align": props.align ?? "left",
        opacity: anim().opacity,
        transform: anim().transform,
        filter: anim().filter,
      }}
    >
      {props.eyebrow ? (
        <div
          style={{
            "font-size": `${TYPE.eyebrow}px`,
            "font-weight": "700",
            "letter-spacing": "0.18em",
            "text-transform": "uppercase",
            color: theme().accent,
            "margin-bottom": "18px",
          }}
        >
          {props.eyebrow}
        </div>
      ) : null}
      {props.children as never}
    </div>
  );
}
