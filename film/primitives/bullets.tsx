/**
 * `bullets` — up to four lines that assemble.
 *
 * The stagger is not a constant: each item can carry `atMs`, copied off the
 * transcript entry for the word it belongs to, so a line lands when it is said.
 * Items without one spread evenly across the segment. That is upstream's rule
 * and it is the whole reason this graphic works — a list that appears on a timer
 * is a list that fights the voice.
 */
import { For } from "solid-js";
import { CanvasFrame, TYPE, DEFAULT_THEME, entrance, useLocalTime, type Theme } from "./frame";
import { FORMATS, cardBox, type Format } from "../format";

export type BulletItem = { text: string; atMs?: number };

export type BulletsProps = {
  title?: string;
  items: BulletItem[];
  eyebrow?: string;
  theme?: Theme;
  /** Seconds. `atMs` values are reel-absolute, so both are needed. */
  start: number;
  end: number;
  name?: string;
  /** Where the card goes. Defaults to portrait so existing callers are unchanged. */
  format?: Format;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
};

/**
 * How tall a bullets card draws when nothing overrides it. This is the tallest
 * card the library produces, which is why `TALLEST_CARD` in ../format is
 * checked against the safe area using this number.
 */
const HEIGHT = 560;

export function Bullets(props: BulletsProps) {
  const t = useLocalTime(() => props.start);
  const theme = () => ({ ...DEFAULT_THEME, ...(props.theme ?? {}) });
  const box = () =>
    cardBox(props.format ?? FORMATS.portrait, props.height ?? HEIGHT, {
      x: props.x,
      y: props.y,
      width: props.width,
    });

  /** Seconds after this graphic appears at which item `i` should land. */
  const at = (i: number) => {
    const item = props.items[i];
    if (item?.atMs !== undefined) return item.atMs / 1000 - props.start;
    // Even spread across the first 60% of the segment, leaving the last line
    // time to be read.
    const span = (props.end - props.start) * 0.6;
    return 0.35 + (span / Math.max(props.items.length, 1)) * i;
  };

  return (
    <html
      x={box().x}
      y={box().y}
      width={box().width}
      height={box().height}
      start={props.start}
      end={props.end}
      name={props.name ?? `Bullets: ${props.title ?? props.items[0]?.text ?? ""}`}
    >
      <CanvasFrame theme={props.theme} eyebrow={props.eyebrow} t={t()}>
        {props.title ? (
          <div
            style={{
              "font-size": `${TYPE.title}px`,
              "font-weight": "800",
              "letter-spacing": "-0.02em",
              "margin-bottom": "36px",
            }}
          >
            {props.title}
          </div>
        ) : null}

        <div style={{ display: "flex", "flex-direction": "column", gap: "26px" }}>
          <For each={props.items}>
            {(item, i) => (
              <div
                style={{
                  display: "flex",
                  "align-items": "baseline",
                  gap: "22px",
                  ...entrance(t() - at(i()), { rise: 22, blur: 6 }),
                }}
              >
                <div
                  style={{
                    width: "14px",
                    height: "14px",
                    "border-radius": "7px",
                    background: theme().accent,
                    "flex-shrink": "0",
                    transform: "translateY(-6px)",
                  }}
                />
                <div
                  style={{
                    "font-size": `${TYPE.body}px`,
                    "font-weight": "600",
                    "line-height": "1.3",
                    "letter-spacing": "-0.01em",
                  }}
                >
                  {item.text}
                </div>
              </div>
            )}
          </For>
        </div>
      </CanvasFrame>
    </html>
  );
}
