/**
 * **Is the stranded ground reachable, or only unserved by waypoints?** — #427.
 *
 * The distinction decides the fix, and a ground-level 2-D flood fill CANNOT
 * answer it: it cannot climb a bridge deck, which is how a child gets outside
 * the loop at all. An earlier fill reported a confident "genuinely sealed off"
 * and its own control killed it — it reached 2 of the 78 reachable waypoints
 * that live outside the loop.
 *
 * So this fill uses `poiGraph.ts`'s **own** walkability test, reproduced from
 * `isClear`: the probe stands at `bridgeHeightAt(x, z)` rather than at ground,
 * and narrows to `PAVED_CLEARANCE` on paving. Off a bridge that is identical to
 * the ground-level probe; on one it is the thing that makes a deck passable.
 * The same control is re-run at the bottom, and if it does not pass, this
 * instrument is no more trustworthy than the last one.
 */
import './headless-canvas.mjs';
import { Vector3 } from 'three';
import { buildHeadlessPark, quietly } from './park-harness.mts';
import { PoiGraph } from '../src/entities/npc/poiGraph.ts';
import { bridgeHeightAt } from '../src/world/train/bridges.ts';
import { isOnPath } from '../src/world/pathGraph.ts';
import { NPC_RADIUS } from '../src/core/constants.ts';
import { TRAIN_PLAN } from '../src/world/train/plan.ts';

const CLEARANCE = 0.7;
const PAVED_CLEARANCE = NPC_RADIUS - 0.02;

const park = buildHeadlessPark();
const collision = park.world.collision;
const height = (x: number, z: number) => bridgeHeightAt(park.world.train.bridges, x, z);
const graph = quietly(() => new PoiGraph(collision, height));
const route = TRAIN_PLAN.route;

const probe = new Vector3();
const isClear = (x: number, z: number): boolean => {
  probe.set(x, height(x, z) ?? 0, z);
  collision.resolve(probe, isOnPath(x, z, 0) ? PAVED_CLEARANCE : CLEARANCE);
  const dx = probe.x - x;
  const dz = probe.z - z;
  return dx * dx + dz * dz < 1e-6;
};

const CELL = 0.5;
const key = (i: number, j: number) => i * 100000 + j;
const stranded = graph.nodes.filter((n) => !n.reachable);
const reachable = graph.nodes.filter((n) => n.reachable);
const start = reachable[0]!;
const seen = new Set<number>();
const queue: [number, number][] = [[Math.round(start.x / CELL), Math.round(start.z / CELL)]];
seen.add(key(queue[0]![0], queue[0]![1]));
let filled = 0;
while (queue.length) {
  const [i, j] = queue.pop()!;
  filled += 1;
  for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    const ni = i + di, nj = j + dj;
    const k = key(ni, nj);
    if (seen.has(k)) continue;
    const x = ni * CELL, z = nj * CELL;
    if (Math.abs(x) > 130 || Math.abs(z) > 130) continue;
    if (!isClear(x, z)) continue;
    seen.add(k);
    queue.push([ni, nj]);
  }
}
/**
 * Did the fill reach this node? Any filled cell within 1 m counts, not the
 * node's own rounded cell.
 *
 * Not a fudge — measured. Two reachable garden nodes failed an exact-cell test
 * while their own point was clear, their rounded 0.5 m cell was not, and 10 and
 * 16 of the 25 cells within a metre had been filled. That is the grid landing on
 * a blocked cell beside a clear node, which is an artefact of sampling and not a
 * disconnection. An exact-cell test would have failed the control and condemned
 * a sound instrument.
 */
const hit = (n: { x: number; z: number }): boolean => {
  const ci = Math.round(n.x / CELL);
  const cj = Math.round(n.z / CELL);
  for (let di = -2; di <= 2; di += 1)
    for (let dj = -2; dj <= 2; dj += 1) if (seen.has(key(ci + di, cj + dj))) return true;
  return false;
};

// THE CONTROL FIRST. If the fill cannot reach the reachable nodes outside the
// loop, it is measuring "inside the loop" and everything below is void.
const p = new Vector3();
let outsideHit = 0, outsideTotal = 0, insideMissed = 0;
const missedInside: string[] = [];
for (const n of reachable) {
  // Garden only. `PoiGraph` never joins two spaces by an edge — "getting
  // between places is a portal" — so a walking fill through the garden cannot
  // be expected to reach an interior node, and counting one as a miss would
  // condemn a sound instrument.
  if (n.space !== 'garden') continue;
  route.pointAt(route.distanceNear(n.x, n.z), p);
  if (Math.hypot(n.x, n.z) > Math.hypot(p.x, p.z)) {
    outsideTotal += 1;
    if (hit(n)) outsideHit += 1;
  } else if (!hit(n)) { insideMissed += 1; missedInside.push(`(${n.x.toFixed(1)}, ${n.z.toFixed(1)}) space=${n.space}`); }
}
console.log(`filled ${filled} cells from (${start.x.toFixed(1)}, ${start.z.toFixed(1)})`);
console.log(`CONTROL: reaches ${outsideHit}/${outsideTotal} reachable nodes OUTSIDE the loop`);
console.log(`CONTROL: misses ${insideMissed} reachable garden nodes INSIDE the loop${missedInside.length ? ' — ' + missedInside.join('; ') : ''}`);
const valid = outsideTotal > 0 && outsideHit / outsideTotal > 0.9 && insideMissed === 0;
console.log(`CONTROL: instrument ${valid ? 'VALID' : 'INVALID — ignore everything below'}\n`);

let reached = 0;
for (const n of stranded) {
  const h = hit(n);
  if (h) reached += 1;
  console.log(`  (${n.x.toFixed(1)}, ${n.z.toFixed(1)}): ${h ? 'GROUND REACHABLE — waypoints too sparse to chain' : 'ground SEALED'}`);
}
console.log(`\n${reached}/${stranded.length} stranded waypoints stand on ground a child can reach.`);

// Are the two misses a real disconnection, or grid quantisation? Ask whether
// the node's own point is clear, whether its rounded cell is, and whether any
// cell within a metre of it was filled.
console.log('\nthe two missed inside-nodes, examined:');
for (const n of reachable) {
  if (hit(n) || n.space !== 'garden') continue;
  const cellX = Math.round(n.x / CELL) * CELL;
  const cellZ = Math.round(n.z / CELL) * CELL;
  let nearbyFilled = 0;
  for (let di = -2; di <= 2; di += 1)
    for (let dj = -2; dj <= 2; dj += 1)
      if (seen.has(key(Math.round(n.x / CELL) + di, Math.round(n.z / CELL) + dj))) nearbyFilled += 1;
  console.log(
    `  (${n.x.toFixed(1)}, ${n.z.toFixed(1)}): node point clear=${isClear(n.x, n.z)}, ` +
      `its cell (${cellX.toFixed(1)}, ${cellZ.toFixed(1)}) clear=${isClear(cellX, cellZ)}, ` +
      `filled cells within 1 m = ${nearbyFilled}/25`,
  );
}
