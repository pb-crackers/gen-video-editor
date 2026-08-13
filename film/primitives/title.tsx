/**
 * `title` — a statement card.
 *
 * Used for the hook in the first seconds and for section breaks: the two places
 * a viewer decides whether to keep watching. Ported from directors-cut's
 * TitleCanvas, including its one piece of content-awareness — a long title
 * steps down a size rather than overflowing.
 */
import { CanvasFrame, TYPE, CARD, DEFAULT_THEME, entrance, useLocalTime, type Theme } from "./frame";

export type TitleProps = {
  title: string;
  subtitle?: string;
  eyebrow?: string;
  theme?: Theme;
  start: number;
  end: number;
  name?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
};

export function Title(props: TitleProps) {
  const t = useLocalTime(() => props.start);
  const theme = () => ({ ...DEFAULT_THEME, ...(props.theme ?? {}) });

  return (
    <html
      x={props.x ?? CARD.x}
      y={props.y ?? CARD.y}
      width={props.width ?? CARD.width}
      height={props.height ?? 520}
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
