/**
 * Frame format: portrait for reels, landscape for YouTube.
 *
 * ## The rule that makes this cheap
 *
 * **The card stays the same size in both formats; only where it sits changes.**
 *
 * That is not a shortcut, it is the reason the reviewed portrait design
 * survives the port. Every type size in the library was tuned against a 940px
 * card — `display` at 108, `value` at 112, the 0.62em advance `stat` uses to
 * decide when a long number has to step down. Those numbers are tuned to the
 * *card*, not to the frame. Keep the card and they all still hold; rescale the
 * card and every one of them has to be re-reviewed against a moving target.
 *
 * It also happens to be defensible on its own terms. Both formats are 1080 on
 * their short side, so a pixel is the same fraction of the smaller dimension in
 * each, and 940 of 1920 leaves 980px of landscape frame for the speaker —
 * roughly the graphic-beside-speaker arrangement a landscape explainer wants
 * anyway.
 *
 * ## What actually differs
 *
 * Placement and keep-out. A reel is watched inside a column of platform chrome
 * that eats the bottom third and a strip down the right; a YouTube frame gives
 * back almost all of that and takes a bar at the bottom for player controls.
 *
 * The insets below are **judgement, not measurement** — sensible starting
 * values taken from where the chrome sits on each platform today. They are in
 * one table so that when someone does measure them properly there is exactly
 * one place to correct.
 */

export type FormatName = "portrait" | "landscape";

/** Keep-out where platform chrome sits, in pixels from each edge. */
export type SafeInsets = { top: number; right: number; bottom: number; left: number };

/** Where a graphic's card is drawn. Height is the primitive's business. */
export type CardBox = { x: number; y: number; width: number };

export type Format = {
  name: FormatName;
  width: number;
  height: number;
  safe: SafeInsets;
  card: CardBox;
};

/**
 * The one type scale, shared by both formats — see the note above on why it can
 * be. Primitives pick from this; they do not invent sizes.
 */
export const TYPE = {
  display: 108,
  displayLong: 84,
  title: 58,
  value: 112,
  label: 44,
  body: 38,
  sub: 28,
  eyebrow: 26,
} as const;

/** Card chrome, also format-independent for the same reason. */
export const CARD_STYLE = {
  radius: 28,
  padding: "32px 40px",
  hairline: "1px solid rgba(255,255,255,.12)",
} as const;

/** The width every card is drawn at, in both formats. */
export const CARD_WIDTH = 940;

export const FORMATS: Record<FormatName, Format> = {
  /**
   * Reels, TikTok, Shorts. `card` is exactly the geometry the existing library
   * was reviewed at — do not adjust it without re-reviewing every primitive.
   */
  portrait: {
    name: "portrait",
    width: 1080,
    height: 1920,
    // The action rail runs down the right; captions and the caption bar eat the
    // bottom. Generous, because being clipped by platform UI is unrecoverable.
    safe: { top: 120, right: 140, bottom: 320, left: 40 },
    card: { x: 70, y: 200, width: CARD_WIDTH },
  },

  /**
   * YouTube. The card sits left and the speaker gets the right of the frame,
   * which is the arrangement the same card width falls into naturally at this
   * aspect.
   */
  landscape: {
    name: "landscape",
    width: 1920,
    height: 1080,
    // Only the player control bar to avoid, and it auto-hides.
    safe: { top: 60, right: 60, bottom: 120, left: 60 },
    // y is chosen so the tallest primitive (bullets, 560) still clears the
    // control bar; see the test that pins exactly that.
    card: { x: 80, y: 280, width: CARD_WIDTH },
  },
};

/** The tallest any primitive in the library draws. `bullets` at four items. */
export const TALLEST_CARD = 560;

export function formatByName(name: FormatName): Format {
  const format = FORMATS[name];
  if (!format) throw new Error(`Unknown format "${name}". Known: ${Object.keys(FORMATS).join(", ")}.`);
  return format;
}

/**
 * Name the format matching a width and height.
 *
 * Exists so a config that only carries dimensions still resolves to a format
 * rather than silently falling back to portrait — a landscape reel rendered
 * with portrait keep-out puts the graphic under the player controls, and
 * nothing about that failure says "wrong format".
 */
export function formatForSize(width: number, height: number): Format | null {
  for (const format of Object.values(FORMATS)) {
    if (format.width === width && format.height === height) return format;
  }
  return null;
}

/** Is `box` clear of the platform chrome on every side? */
export function withinSafeArea(format: Format, box: { x: number; y: number; width: number; height: number }): boolean {
  return (
    box.x >= format.safe.left &&
    box.y >= format.safe.top &&
    box.x + box.width <= format.width - format.safe.right &&
    box.y + box.height <= format.height - format.safe.bottom
  );
}

/** Is `box` inside the frame at all, safe area aside? */
export function withinFrame(format: Format, box: { x: number; y: number; width: number; height: number }): boolean {
  return (
    box.x >= 0 &&
    box.y >= 0 &&
    box.x + box.width <= format.width &&
    box.y + box.height <= format.height
  );
}

/**
 * The card box for a primitive of a given height, with any explicit overrides
 * applied. Primitives call this rather than reaching for constants, which is
 * what stops the next one from baking in portrait the way `stat` did.
 */
export function cardBox(
  format: Format,
  height: number,
  overrides: Partial<{ x: number; y: number; width: number }> = {},
): { x: number; y: number; width: number; height: number } {
  return {
    x: overrides.x ?? format.card.x,
    y: overrides.y ?? format.card.y,
    width: overrides.width ?? format.card.width,
    height,
  };
}
