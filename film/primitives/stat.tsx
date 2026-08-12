/**
 * `stat` — one big number.
 *
 * Ported from directors-cut's StatCanvas, keeping its authoring contract
 * verbatim (value / label / sublabel / countUp) and swapping React+CSS for
 * Solid + <html>. The caller supplies content and timing; everything else —
 * type scale, colour, layout, easing, the count-up — belongs to the primitive.
 *
 * That split is the whole point: two different films asking for a stat get the
 * same graphic, and neither one gets to reinvent the type scale.
 */
import { createEffect } from "solid-js";
import { createStore } from "solid-js/store";
import { createTimeline } from "animejs";
import { useTicker } from "@diffusionstudio/jsx";

/** The design system this primitive draws from. Not caller-settable. */
const TOKENS = {
  sans: "Inter, 'Helvetica Neue', Helvetica, sans-serif",
  accent: "#FFB627",
  ink: "#FFFFFF",
  card: "rgba(12,14,18,.86)",
  hairline: "1px solid rgba(255,255,255,.12)",
  radius: "28px",
  valueSize: 112,
  labelSize: 44,
  subSize: 28,
  eyebrowSize: 26,
};

export type StatTheme = { accent: string; ink: string; card: string };

export type StatProps = {
  /** The number, as written. "1.4M downloads" and "~10" both work. */
  value: string;
  label: string;
  sublabel?: string;
  /** Count up from zero. Ignored when `value` has no leading number. */
  countUp?: boolean;
  eyebrow?: string;
  /** Timeline placement, in seconds. */
  start: number;
  end: number;
  /**
   * Film-level palette. Colour only — the type scale, layout and easing stay
   * with the primitive, which is what keeps two films' stats the same graphic.
   */
  theme?: StatTheme;
  /** Node name. The compiler stamps the segment id here; see film/compile.tsx. */
  name?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
};

/**
 * Splits "1.4M downloads" into the number to animate and the text around it, so
 * a count-up works on values that are not bare numbers. Null when there is no
 * leading number, in which case the value is shown as written.
 */
function parseValue(value: string) {
  const match = /^([^\d-]*)(-?\d+(?:\.\d+)?)(.*)$/.exec(value);
  if (!match) return null;
  const [, prefix, digits, suffix] = match;
  return {
    prefix,
    number: Number(digits),
    suffix,
    decimals: (digits.split(".")[1] ?? "").length,
  };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

export function Stat(props: StatProps) {
  const theme = (): StatTheme =>
    props.theme ?? { accent: TOKENS.accent, ink: TOKENS.ink, card: TOKENS.card };
  const parsed = () => (props.countUp !== false ? parseValue(props.value) : null);

  const v = { rise: 36, opacity: 0, count: 0, note: 0 };
  const [s, set] = createStore({ ...v });

  const tl = createTimeline({ autoplay: false })
    .add(v, { rise: 0, opacity: 1, duration: 520, ease: "outCubic" }, 0)
    .add(v, { count: 1, duration: 1300, ease: "outCubic" }, 340)
    .add(v, { note: 1, duration: 460, ease: "outCubic" }, 900);

  const { time } = useTicker();
  createEffect(() => {
    tl.seek(clamp((time() - props.start) * 1000, 0, tl.duration));
    set({ ...v });
  });

  const shown = () => {
    const p = parsed();
    if (!p) return props.value;
    return `${p.prefix}${(p.number * s.count).toFixed(p.decimals)}${p.suffix}`;
  };

  /**
   * Fit the value to the card instead of letting it shove the label off the
   * edge. "6.5" and "1.4M downloads" are both legal values, and a primitive
   * that only looks right for the short one is not a primitive.
   *
   * Measured against the widest string the count-up will pass through, not the
   * current frame's — otherwise the type resizes while the number counts.
   */
  const widest = () => {
    const p = parsed();
    return p ? `${p.prefix}${p.number.toFixed(p.decimals)}${p.suffix}` : props.value;
  };
  const valueSize = () => {
    const n = widest().length;
    if (n <= 6) return TOKENS.valueSize;
    // ~0.62em average advance for this weight; leave the label half the card.
    const budget = ((props.width ?? 940) - 80) * 0.52;
    return Math.max(44, Math.min(TOKENS.valueSize, budget / (n * 0.62)));
  };

  return (
    <html
      x={props.x ?? 70}
      y={props.y ?? 200}
      width={props.width ?? 940}
      height={props.height ?? 360}
      start={props.start}
      end={props.end}
      name={props.name ?? `Stat: ${props.label}`}
    >
      <div
        style={{
          "box-sizing": "border-box",
          padding: "32px 40px",
          "font-family": TOKENS.sans,
          color: theme().ink,
          background: theme().card,
          border: TOKENS.hairline,
          "border-radius": TOKENS.radius,
          display: "flex",
          "align-items": "center",
          gap: "28px",
          transform: `translateY(${s.rise}px)`,
          opacity: s.opacity,
        }}
      >
        <div
          style={{
            "font-size": `${valueSize()}px`,
            "font-weight": "800",
            "letter-spacing": "-0.05em",
            "line-height": "1",
            color: theme().accent,
            "white-space": "nowrap",
            "flex-shrink": "0",
          }}
        >
          {shown()}
        </div>
        <div style={{ "min-width": "0" }}>
          {props.eyebrow ? (
            <div
              style={{
                "font-size": `${TOKENS.eyebrowSize}px`,
                "font-weight": "700",
                "letter-spacing": "0.18em",
                color: theme().accent,
                "margin-bottom": "8px",
              }}
            >
              {props.eyebrow}
            </div>
          ) : null}
          <div
            style={{
              "font-size": `${TOKENS.labelSize}px`,
              "font-weight": "700",
              "letter-spacing": "-0.02em",
            }}
          >
            {props.label}
          </div>
          {props.sublabel ? (
            <div
              style={{
                "font-size": `${TOKENS.subSize}px`,
                opacity: s.note * 0.66,
                "margin-top": "8px",
              }}
            >
              {props.sublabel}
            </div>
          ) : null}
        </div>
      </div>
    </html>
  );
}
