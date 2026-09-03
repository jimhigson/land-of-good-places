/** TEMP diagnostic: what seeded a waypoint that has NO neighbours at all?
 *
 * A stranded node with `nbrs=0` is 20-odd metres from anything in the pocket
 * probe's output, which says where it isn't but not what put it there. This
 * asks the three things that can: how far is the nearest DRAWN paving, which
 * anchor's doormat is it, and did its door get a grid connector.
 *
 * CONTROL: the same three columns are printed for reachable nodes. If the
 * nearest-paving column reads the same for both, it is not the discriminator
 * and nothing may be concluded from it. */
import { buildHeadlessPark, quietly } from './park-harness.mts';
import { PoiGraph } from '../src/entities/npc/poiGraph.ts';
import { bridgeHeightAt } from '../src/world/train/bridges.ts';
import { ROUTES, routeCurve } from '../src/world/pathGraph.ts';
import { PARK_LAYOUT } from '../src/world/parkLayout.ts';
import { debugRelaxedDoors } from '../src/world/paths.ts';

const park = quietly(() => buildHeadlessPark());
const world = park.world;
const graph = quietly(
  () => new PoiGraph(world.collision, (x, z) => bridgeHeightAt(world.train.bridges, x, z)),
);
type N = { index: number; x: number; z: number; reachable: boolean; neighbours: number[] };
const nodes = graph.nodes as readonly N[];

/** Densely sampled paving, once. */
const paving: { x: number; z: number; name: string }[] = [];
for (const route of ROUTES) {
  const curve = routeCurve(route);
  const n = Math.max(8, Math.ceil(curve.getLength() / 0.5));
  for (let i = 0; i <= n; i += 1) {
    const p = curve.getPoint(i / n);
    paving.push({ x: p.x, z: p.z, name: route.name });
  }
}

const nearestPaving = (x: number, z: number): { d: number; name: string } => {
  let best = Infinity;
  let name = '-';
  for (const p of paving) {
    const d = Math.hypot(p.x - x, p.z - z);
    if (d < best) {
      best = d;
      name = p.name;
    }
  }
  return { d: best, name };
};

const anchors = [...PARK_LAYOUT.entries.values()] as readonly {
  id: string;
  entranceX: number;
  entranceZ: number;
}[];
const nearestDoormat = (x: number, z: number): { d: number; id: string } => {
  let best = Infinity;
  let id = '-';
  for (const a of anchors) {
    const d = Math.hypot(a.entranceX - x, a.entranceZ - z);
    if (d < best) {
      best = d;
      id = a.id;
    }
  }
  return { d: best, id };
};

const describe = (n: N): string => {
  const pav = nearestPaving(n.x, n.z);
  const door = nearestDoormat(n.x, n.z);
  return (
    `(${n.x.toFixed(1)},${n.z.toFixed(1)}) nbrs=${n.neighbours.length} ` +
    `nearestPaving=${pav.d.toFixed(2)}m (${pav.name}) ` +
    `nearestDoormat=${door.d.toFixed(2)}m (${door.id})`
  );
};

console.log(`seed ${process.env.LGP_SEED ?? '(canonical)'}`);
console.log('relaxed/failed doors:', debugRelaxedDoors());
const stranded = nodes.filter((n) => !n.reachable);
console.log(`\nstranded ${stranded.length}; the nbrs=0 ones first:`);
for (const n of stranded.filter((q) => q.neighbours.length === 0)) console.log('  X0', describe(n));
for (const n of stranded.filter((q) => q.neighbours.length > 0)) console.log('  X ', describe(n));

console.log('\ncontrol (reachable, same columns):');
for (const n of nodes.filter((q) => q.reachable).slice(0, 6)) console.log('  . ', describe(n));
