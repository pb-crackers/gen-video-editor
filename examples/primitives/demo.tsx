/**
 * What a primitive buys: three stats, three different contents, one graphic.
 * The caller writes content and timing. Nothing else is available to get wrong.
 */
import { Stat } from "../../film/primitives/stat";

const W = 1080;
const H = 1920;

export default function PrimitivesDemo() {
  return (
    <rect scene="primitives-demo" name="Primitives demo" width={W} height={H} fill="#141821">
      <Stat value="~10 hours" label="of work" sublabel="total — built between shifts" start={0} end={6} />
      <Stat value="1.4M downloads" label="last quarter" eyebrow="NPM" start={6} end={12} />
      <Stat value="6.5" label="phases shipped" sublabel="of 25, and the plan grows" start={12} end={18} />
    </rect>
  );
}
