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

export type Theme = { accent: string; ink: string; card: string; muted?: string };

export const DEFAULT_THEME: Required<Theme> = {
  accent: "#FFB627",
  ink: "#FFFFFF",
  card: "rgba(12,14,18,.86)",
  muted: "rgba(255,255,255,.62)",
};

/** One type scale. Primitives pick from it; they do not invent sizes. */
export const TYPE = {
  display: 108,
  displayLong: 84,
  title: 58,
  value: 112,
  label: 44,
  body: 38,
  sub: 28,
  eyebrow: 26,
};

export const CARD = {
  x: 70,
  y: 200,
  width: 940,
  radius: 28,
  padding: "32px 40px",
  hairline: "1px solid rgba(255,255,255,.12)",
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
