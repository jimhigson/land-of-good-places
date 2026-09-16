/** Road height vs the soffit across the tunnel opening, along the bridge axis. */
import './headless-canvas.mjs';
import { buildParkFacts } from '../test/procgen/parkFacts.ts';

const seed = Number(process.env.LGP_SEED ?? 20260728);
const facts = await buildParkFacts(seed);
const bridges = facts.world.train.bridges;

for (const crossing of facts.world.train.crossings) {
  const name = `bridge-${crossing.railDistance.toFixed(1)}`;
  const bridge = bridges.find((b) => b.deckCovers(crossing.x, crossing.z));
  if (!bridge) continue;
  const r = Math.hypot(crossing.x, crossing.z);
  // The soffit is asked of the arch that draws it, in each column (#635) — not
  // read off the `deck` marker's AABB, which is a plate lying flat in world y
  // and falls up to 1.4 m out against a bridge that leans with the planet.
  console.log(`\n${name} at (${crossing.x.toFixed(1)}, ${crossing.z.toFixed(1)}), r=${r.toFixed(0)} m`);
  console.log(`  along     road    soffit  road-soffit`);
  for (let a = -3; a <= 3.0001; a += 0.5) {
    const x = crossing.x + crossing.pathDirX * a;
    const z = crossing.z + crossing.pathDirZ * a;
    const road = bridge.pavingHeightAt(x, z);
    const soffit = bridge.soffitYAt(x, z);
    const cell =
      road === null
        ? '   (outside stone)'
        : soffit === null
          ? `${road.toFixed(3).padStart(9)}  (no arch in this column)`
          : `${road.toFixed(3).padStart(9)} ${soffit.toFixed(3).padStart(9)}  ${(road - soffit).toFixed(3).padStart(8)}`;
    console.log(`  ${a.toFixed(1).padStart(5)}  ${cell}`);
  }
}
