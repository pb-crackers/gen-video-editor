/**
 * `title` — a statement card.
 *
 * Used for the hook in the first seconds and for section breaks: the two places
 * a viewer decides whether to keep watching. Ported from directors-cut's
 * TitleCanvas, including its one piece of content-awareness — a long title
 * steps down a size rather than overflowing.
 */
import { CanvasFrame, TYPE, DEFAULT_THEME, entrance, useLocalTime, type Theme } from "./frame";
import { FORMATS, cardBox, type Format } from "../format";

/** How tall a title card draws when nothing overrides it. */
const HEIGHT = 520;

export type TitleProps = {
  title: string;
  subtitle?: string;
  eyebrow?: string;
  theme?: Theme;
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

export function Title(props: TitleProps) {
  const t = useLocalTime(() => props.start);
  const theme = () => ({ ...DEFAULT_THEME, ...(props.theme ?? {}) });
  const box = () =>
    cardBox(props.format ?? FORMATS.portrait, props.height ?? HEIGHT, {
      x: props.x,
      y: props.y,
      width: props.width,
    });

  return (
    <html
      x={box().x}
      y={box().y}
      width={box().width}
      height={box().height}
      start={props.start}
      end={props.end}
      name={props.name ?? `Title: ${props.title}`}
    >
      <CanvasFrame theme={props.theme} eyebrow={props.eyebrow} t={t()}>
        <div
          style={{
            "font-size": `${props.title.length > 40 ? TYPE.displayLong : TYPE.display}px`,
            "font-weight": "800",
            "line-height": "1.05",
            "letter-spacing": "-0.03em",
            "text-wrap": "balance",
          }}
        >
          {props.title}
        </div>
        {props.subtitle ? (
          <div
            style={{
              "margin-top": "32px",
              "font-size": `${TYPE.label}px`,
              "font-weight": "500",
              "line-height": "1.25",
              color: theme().muted,
              // Trails the title, as upstream does — the statement lands first.
              ...entrance(t() - 0.27, { rise: 14, blur: 4 }),
            }}
          >
            {props.subtitle}
          </div>
        ) : null}
      </CanvasFrame>
    </html>
  );
}
