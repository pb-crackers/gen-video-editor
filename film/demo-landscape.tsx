/**
 * The same film, in the other frame.
 *
 * This is the whole argument for the format module in six lines: `demo.json` is
 * not edited, not copied and not conditionalised. One field changes and every
 * graphic moves to where a 1920×1080 frame wants it, at the same card size and
 * the same type scale it was reviewed at.
 *
 *   dapi mount film/demo-landscape.tsx
 *
 * The A-roll in `demo.json` is portrait footage, so it does not itself belong
 * in a landscape frame — this demonstrates the graphics layer. Real landscape
 * work wants landscape source.
 */
import config from "./demo.json";
import { parseReel } from "./schema";
import { compileReel } from "./compile";

export default function Film() {
  return compileReel(
    parseReel({
      ...config,
      // A distinct title so this mounts as its own scene rather than replacing
      // the portrait one — `compileReel` derives the scene key from the title.
      title: "Dev Log Part 3 (landscape)",
      format: "landscape",
    }),
  );
}
