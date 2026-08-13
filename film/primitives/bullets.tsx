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
import { CanvasFrame, TYPE, CARD, DEFAULT_THEME, entrance, useLocalTime, type Theme } from "./frame";

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
  x?: number;
  y?: number;
  width?: number;
  height?: number;
};

export function Bullets(props: BulletsProps) {
  const t = useLocalTime(() => props.start);
  const theme = () => ({ ...DEFAULT_THEME, ...(props.theme ?? {}) });

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
      x={props.x ?? CARD.x}
      y={props.y ?? CARD.y}
      width={props.width ?? CARD.width}
      height={props.height ?? 560}
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
