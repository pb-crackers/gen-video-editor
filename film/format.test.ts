/**
 * What these guard.
 *
 * The portrait numbers are a reviewed design, and the whole argument for
 * introducing formats is that adding landscape does not disturb them. So the
 * first test pins portrait to the literal values the library was built at: if
 * a refactor moves the card by a pixel, that is a design change and it should
 * have to be typed out deliberately, not arrive as a side effect.
 *
 * The rest are the errors that produce a *plausible-looking* bad frame — a
 * graphic under the player controls, a card off the edge, a landscape layout
 * with no room left for the speaker. None of those throw.
 */
import { describe, expect, it } from "vitest";

import {
  CARD_WIDTH,
  FORMATS,
  TALLEST_CARD,
  TYPE,
  cardBox,
  formatByName,
  formatForSize,
  withinFrame,
  withinSafeArea,
} from "./format";

describe("portrait is exactly the geometry the library was reviewed at", () => {
  it("keeps the frame at 1080x1920", () => {
    expect(FORMATS.portrait.width).toBe(1080);
    expect(FORMATS.portrait.height).toBe(1920);
  });

  it("keeps the card at the reviewed x, y and width", () => {
    // These are the literals that were in frame.tsx before formats existed.
    expect(FORMATS.portrait.card).toEqual({ x: 70, y: 200, width: 940 });
  });

  it("keeps the type scale the primitives were tuned against", () => {
    expect(TYPE).toEqual({
      display: 108,
      displayLong: 84,
      title: 58,
      value: 112,
      label: 44,
      body: 38,
      sub: 28,
      eyebrow: 26,
    });
  });
});

describe("landscape", () => {
  it("is 1920x1080", () => {
    expect(FORMATS.landscape.width).toBe(1920);
    expect(FORMATS.landscape.height).toBe(1080);
  });

  it("draws the card at the same width as portrait, which is the whole point", () => {
    expect(FORMATS.landscape.card.width).toBe(CARD_WIDTH);
    expect(FORMATS.landscape.card.width).toBe(FORMATS.portrait.card.width);
  });

  it("leaves room beside the card for the speaker", () => {
    const { width, card } = FORMATS.landscape;
    const remaining = width - (card.x + card.width);
    // Less than this and "graphic left, speaker right" stops being true and the
    // layout silently becomes a graphic with a sliver of person next to it.
    expect(remaining).toBeGreaterThanOrEqual(800);
  });
});

describe("every format keeps the tallest card clear of platform chrome", () => {
  // bullets at four items is the tallest thing the library draws; if that fits,
  // everything shorter does. A graphic under the player controls or behind the
  // caption bar renders perfectly and is simply unreadable.
  for (const format of Object.values(FORMATS)) {
    it(`${format.name}: the tallest card is inside the frame`, () => {
      expect(withinFrame(format, cardBox(format, TALLEST_CARD))).toBe(true);
    });

    it(`${format.name}: the tallest card clears the bottom chrome`, () => {
      // The one that is never survivable. Bottom chrome — caption bar, player
      // controls — covers content outright, where the side rail is icons with
      // gaps between them.
      const box = cardBox(format, TALLEST_CARD);
      expect(box.y + box.height).toBeLessThanOrEqual(format.height - format.safe.bottom);
    });

    it(`${format.name}: the safe area is smaller than the frame`, () => {
      const { safe, width, height } = format;
      expect(safe.left + safe.right).toBeLessThan(width);
      expect(safe.top + safe.bottom).toBeLessThan(height);
    });
  }

  it("landscape clears chrome on every side, with room to spare", () => {
    expect(withinSafeArea(FORMATS.landscape, cardBox(FORMATS.landscape, TALLEST_CARD))).toBe(true);
  });

  /**
   * A conflict between two things that are both true, pinned rather than
   * resolved.
   *
   * The portrait card geometry is reviewed and shipping: a symmetric 70px
   * margin, 940 wide. The right-hand action rail on reels is roughly 140px.
   * Those do not both fit, so the shipped design already runs 70px under the
   * rail — and it is not obviously wrong, because the overlap is the card's
   * background and its 40px padding rather than its text.
   *
   * This is asserted as it is, not as anyone would like it, so that narrowing
   * the card or loosening the inset is a decision someone types out. Do not
   * "fix" this test by changing the number it checks.
   */
  it("portrait's reviewed card knowingly runs under the right action rail", () => {
    const box = cardBox(FORMATS.portrait, TALLEST_CARD);
    expect(withinFrame(FORMATS.portrait, box)).toBe(true);
    expect(withinSafeArea(FORMATS.portrait, box)).toBe(false);

    const overlap = box.x + box.width - (FORMATS.portrait.width - FORMATS.portrait.safe.right);
    expect(overlap).toBe(70);
  });
});

describe("withinSafeArea", () => {
  const portrait = FORMATS.portrait;

  it("rejects a card that runs under the caption bar", () => {
    const box = { x: 70, y: 1500, width: 940, height: 300 };
    expect(withinSafeArea(portrait, box)).toBe(false);
    // …but it is still on the frame, which is why the two checks are separate:
    // this renders, looks fine in a still, and is covered in the app.
    expect(withinFrame(portrait, box)).toBe(true);
  });

  it("rejects a card pushed past the right edge", () => {
    expect(withinSafeArea(portrait, { x: 900, y: 300, width: 940, height: 200 })).toBe(false);
  });

  it("accepts a card sitting exactly on the safe boundary", () => {
    const { safe, width, height } = portrait;
    const box = {
      x: safe.left,
      y: safe.top,
      width: width - safe.left - safe.right,
      height: height - safe.top - safe.bottom,
    };
    expect(withinSafeArea(portrait, box)).toBe(true);
  });
});

describe("formatForSize", () => {
  it("names portrait and landscape from their dimensions", () => {
    expect(formatForSize(1080, 1920)?.name).toBe("portrait");
    expect(formatForSize(1920, 1080)?.name).toBe("landscape");
  });

  it("returns null for a size no format claims, rather than guessing", () => {
    // Guessing here is how a square or 4:3 config silently gets portrait
    // keep-out and puts its graphic under the platform UI.
    expect(formatForSize(1080, 1080)).toBeNull();
    expect(formatForSize(1280, 720)).toBeNull();
  });
});

describe("formatByName", () => {
  it("returns the named format", () => {
    expect(formatByName("landscape")).toBe(FORMATS.landscape);
  });

  it("refuses an unknown name and lists the ones that exist", () => {
    // @ts-expect-error deliberately wrong, which is how it arrives from JSON
    expect(() => formatByName("square")).toThrow(/square/);
    // @ts-expect-error same
    expect(() => formatByName("square")).toThrow(/portrait, landscape/);
  });
});

describe("cardBox", () => {
  it("uses the format's card by default", () => {
    expect(cardBox(FORMATS.portrait, 360)).toEqual({ x: 70, y: 200, width: 940, height: 360 });
  });

  it("gives a different box per format for the same primitive", () => {
    const p = cardBox(FORMATS.portrait, 360);
    const l = cardBox(FORMATS.landscape, 360);
    expect(l).not.toEqual(p);
    expect(l.width).toBe(p.width);
  });

  it("lets a caller override one axis without losing the others", () => {
    expect(cardBox(FORMATS.portrait, 360, { y: 900 })).toEqual({
      x: 70,
      y: 900,
      width: 940,
      height: 360,
    });
  });

  it("treats an explicit 0 as a position, not as missing", () => {
    // `??` rather than `||` — a graphic pinned to the top-left edge is a real
    // thing to ask for and `||` would silently ignore it.
    expect(cardBox(FORMATS.portrait, 360, { x: 0, y: 0 })).toMatchObject({ x: 0, y: 0 });
  });
});
