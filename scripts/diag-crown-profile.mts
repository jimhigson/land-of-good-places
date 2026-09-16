/** Road height vs the soffit across the tunnel opening, along the bridge axis. */
import './headless-canvas.mjs';
import { Box3 } from 'three';
import { buildParkFacts } from '../test/procgen/parkFacts.ts';

const seed = Number(process.env.LGP_SEED ?? 20260728);
const facts = await buildParkFacts(seed);
const bridges = facts.world.train.bridges;

for (const crossing of facts.world.train.crossings) {
  const name = `bridge-${crossing.railDistance.toFixed(1)}`;
  const deckMesh = facts.world.train.group.getObjectByName(name)?.getObjectByName('deck');
  const bridge = bridges.find((b) => b.deckCovers(crossing.x, crossing.z));
  if (!deckMesh || !bridge) continue;
  const soffit = new Box3().setFromObject(deckMesh).min.y;
  const r = Math.hypot(crossing.x, crossing.z);
  console.log(`\n${name} at (${crossing.x.toFixed(1)}, ${crossing.z.toFixed(1)}), r=${r.toFixed(0)} m — soffit ${soffit.toFixed(3)}`);
  console.log(`  along     road      road-soffit`);
  for (let a = -3; a <= 3.0001; a += 0.5) {
    const x = crossing.x + crossing.pathDirX * a;
    const z = crossing.z + crossing.pathDirZ * a;
    const road = bridge.pavingHeightAt(x, z);
    const cell = road === null ? '   (outside stone)' : `${road.toFixed(3).padStart(9)}  ${(road - soffit).toFixed(3).padStart(8)}`;
    console.log(`  ${a.toFixed(1).padStart(5)}  ${cell}`);
  }
}
