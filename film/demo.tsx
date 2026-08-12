/**
 * The whole point, in six lines: the edit is a JSON file, and mounting it is
 * parse → compile. Nothing here decides what anything looks like.
 *
 *   dapi mount film/demo.tsx
 */
import config from "./demo.json";
import { parseReel } from "./schema";
import { compileReel } from "./compile";

export default function Film() {
  return compileReel(parseReel(config));
}
