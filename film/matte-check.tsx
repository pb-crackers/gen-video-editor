/**
 * Grade a matte against the plate it will actually ship on.
 *
 * A saturated test backdrop exaggerates every edge artefact and a black one
 * hides them all, so neither tells you anything (docs/matte.md § 5). This is
 * the real arrangement: a dark textured plate, a real graphic from the
 * library, and the speaker cut out in front of it.
 *
 * The graphic sits **where the head goes**, deliberately. A matte only has to
 * be right at the boundary, and the boundary is only visible where something
 * is drawn behind it. Text interrupted mid-word by a jaw is the whole test:
 *
 *   - a halo means alpha is being pre-multiplied somewhere it should not be
 *   - text bleeding through the cheek means the matte is eroded
 *   - a hard stair-stepped jaw means soft pixels were thresholded away
 *   - a cyan or green rim means despill is not doing its job
 *
 *   dapi mount film/matte-check.tsx
 *   dapi node capture <id> -t 0.5 2.0 3.5 -S
 */

/** The matte under test — a VP9+alpha WebM from `generateMatte`. */
const MATTE = "REPLACE_ME";

const W = 1080;
const H = 1920;

/** Where the head sits in this clip. The card is put here on purpose. */
const CARD_Y = 620;

export default function MatteCheck() {
  return (
    <rect scene="matte-check" name="Matte check" width={W} height={H} fill="#0A0C10">
      {/* The plate. Dark, but not black — a black plate hides exactly the edge
          errors this scene exists to reveal. Subtle structure so a halo has
          something to stand against. */}
      <sequence name="Plate">
        <html x={0} y={0} width={W} height={H} start={0} name="plate">
          <div
            style={{
              width: `${W}px`,
              height: `${H}px`,
              background:
                "radial-gradient(120% 80% at 50% 18%, #1E2A3A 0%, #131A24 45%, #0A0C10 100%)",
            }}
          >
            {/* A faint grid: straight lines make a soft or wobbling edge obvious
                in a way a flat wash never does. */}
            <div
              style={{
                width: `${W}px`,
                height: `${H}px`,
                "background-image":
                  "linear-gradient(rgba(255,255,255,.05) 1px, transparent 1px)," +
                  "linear-gradient(90deg, rgba(255,255,255,.05) 1px, transparent 1px)",
                "background-size": "60px 60px",
              }}
            />
          </div>
        </html>
      </sequence>

      {/* The graphic, positioned to be interrupted by the head. */}
      <sequence name="Graphic">
        <html x={40} y={CARD_Y} width={1000} height={460} start={0} name="graphic">
          <div
            style={{
              "box-sizing": "border-box",
              padding: "36px 44px",
              "font-family": "Inter, 'Helvetica Neue', Helvetica, sans-serif",
              color: "#FFFFFF",
              background: "rgba(12,14,18,.86)",
              border: "1px solid rgba(255,255,255,.12)",
              "border-radius": "28px",
            }}
          >
            <div
              style={{
                "font-size": "26px",
                "font-weight": "700",
                "letter-spacing": ".18em",
                "text-transform": "uppercase",
                color: "#FFB627",
                "margin-bottom": "18px",
              }}
            >
              MATTE CHECK
            </div>
            {/* Long enough to run behind the head and out the other side. */}
            <div style={{ "font-size": "84px", "font-weight": "800", "line-height": "1.05", "letter-spacing": "-.03em" }}>
              THE EDGE IS THE WHOLE TEST
            </div>
            <div style={{ "margin-top": "24px", "font-size": "34px", color: "rgba(255,255,255,.62)" }}>
              Text should vanish behind the jaw with no halo and no bleed
            </div>
          </div>
        </html>
      </sequence>

      {/* A bright bar at head height. A light background is the harshest
          honest test of a dark-haired edge. */}
      <sequence name="Bar">
        <html x={0} y={CARD_Y - 180} width={W} height={140} start={0} name="bar">
          <div
            style={{
              width: `${W}px`,
              height: "140px",
              background: "linear-gradient(90deg,#FFB627 0%,#FF7A3D 55%,#F5F7FA 100%)",
            }}
          />
        </html>
      </sequence>

      {/* The subject, cut out, in front of all of it. */}
      <sequence name="Speaker">
        <video src={MATTE} width={W} height={H} start={0} />
      </sequence>
    </rect>
  );
}
