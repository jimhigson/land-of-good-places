/**
 * **Is the paving the clause complains about really under the tunnel ceiling?**
 *
 * The clause takes ONE soffit number per bridge — `Box3.setFromObject(deck).min.y`,
 * the axis-aligned minimum of a marker box — and compares every paving vertex
 * near the track against it. This asks the honest question instead: what is the
 * soffit directly above THIS vertex, and is the vertex below THAT?
 *
 * Control: the same two numbers at the crown centre, where the flat marker and
 * the true soffit must agree — if they disagree there, the instrument is wrong.
 */
import './headless-canvas.mjs';
import { Box3, Vector3 } from 'three';
import { buildParkFacts } from '../test/procgen/parkFacts.ts';
import { TRACK_CLEARANCE } from '../src/world/train/route.ts';

const seed = Number(process.env.LGP_SEED ?? 20260728);
const facts = await buildParkFacts(seed);
const bridges = facts.world.train.bridges;
const route = facts.world.train.route;
const railPoint = { x: 0, z: 0 };
const layers = ['path-surface', 'path-kerb'] as const;

for (const crossing of facts.world.train.crossings) {
  const name = `bridge-${crossing.railDistance.toFixed(1)}`;
  const deckMesh = facts.world.train.group.getObjectByName(name)?.getObjectByName('deck');
  if (!deckMesh) continue;
  const box = new Box3().setFromObject(deckMesh);
  const bridge = bridges.find((b) => b.deckCovers(crossing.x, crossing.z));
  if (!bridge) continue;
  const flatSoffit = box.min.y;
  console.log(`\n${name} at (${crossing.x.toFixed(1)}, ${crossing.z.toFixed(1)})`);
  console.log(`  deck marker AABB: min.y ${box.min.y.toFixed(3)}  max.y ${box.max.y.toFixed(3)}  height ${(box.max.y-box.min.y).toFixed(3)} m (slab is 0.05 m thick)`);
  let worst: { x: number; z: number; y: number; road: number; along: number } | null = null;
  for (const layerName of layers) {
    let position: { count: number; getX(i:number):number; getY(i:number):number; getZ(i:number):number } | undefined;
    facts.world.garden.group.traverse((o: { name?: string; geometry?: { getAttribute: (s: string) => typeof position } }) => {
      if (o.name === layerName && o.geometry) position = o.geometry.getAttribute('position');
    });
    if (!position) continue;
    for (let i = 0; i < position.count; i += 1) {
      const x = position.getX(i), z = position.getZ(i);
      if (bridge.pavingHeightAt(x, z) === null) continue;
      route.flatPointAt(route.distanceNear(x, z), railPoint);
      if (Math.hypot(x - railPoint.x, z - railPoint.z) > TRACK_CLEARANCE) continue;
      const y = position.getY(i);
      if (y < flatSoffit) {
        const road = bridge.pavingHeightAt(x, z) as number;
        const along = (x - crossing.x) * crossing.pathDirX + (z - crossing.z) * crossing.pathDirZ;
        if (!worst || y - flatSoffit < worst.y - flatSoffit) worst = { x, z, y, road, along };
      }
    }
  }
  if (!worst) { console.log('  no vertex below the flat marker'); continue; }
  console.log(`  worst vertex (${worst.x.toFixed(1)}, ${worst.z.toFixed(1)}) y ${worst.y.toFixed(3)}`);
  console.log(`    flat marker min.y        : ${flatSoffit.toFixed(3)}  -> vertex is ${(worst.y-flatSoffit).toFixed(3)} m below it`);
  console.log(`    ROAD SURFACE there       : ${worst.road.toFixed(3)}  -> vertex is ${(worst.y-worst.road).toFixed(3)} m above its own road`);
  console.log(`    road vs flat marker      : road is ${(worst.road-flatSoffit).toFixed(3)} m above the marker min.y`);
  console.log(`    ALONG the bridge axis    : ${worst.along.toFixed(2)} m from the crossing centre (tunnel opening is +/- 1.80 m)`);
  console.log(`    -> ${Math.abs(worst.along) <= 1.8 ? 'OVER THE TUNNEL: the geometry is wrong' : 'BESIDE the tunnel, on the ramp: the CLAUSE is over-reaching'}`);
}
