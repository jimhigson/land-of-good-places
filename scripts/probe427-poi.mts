import './headless-canvas.mjs';
import { Vector3 } from 'three';
import { buildHeadlessPark, quietly } from './park-harness.mts';
import { PoiGraph, SEEDS } from '../src/entities/npc/poiGraph.ts';
import { bridgeHeightAt } from '../src/world/train/bridges.ts';
import { PARK_SEED } from '../src/world/parkManifest.ts';
import { TRAIN_PLAN } from '../src/world/train/plan.ts';
import { CROSSING_SITES, LEVEL_CROSSING_SITES } from '../src/world/train/crossingPlan.ts';

const park = buildHeadlessPark();
const collision = park.world.collision;
const graph = quietly(() => new PoiGraph(collision, (x, z) => bridgeHeightAt(park.world.train.bridges, x, z)));
const stranded = graph.nodes.filter((n) => !n.reachable);
const route = TRAIN_PLAN.route;
console.log(`seed ${PARK_SEED}: ${graph.nodes.length}/${SEEDS.length} placed, ${stranded.length} stranded, loop ${route.length.toFixed(1)} m`);

console.log(`\nbridge sites: ${CROSSING_SITES.map((s) => s.railDistance.toFixed(0)).join(', ') || '(none)'}`);
console.log(`level sites:  ${LEVEL_CROSSING_SITES.map((s) => s.railDistance.toFixed(0)).join(', ') || '(none)'}`);
console.log(`built bridges: ${park.world.train.bridges.length}`);
for (const b of park.world.train.bridges as any[]) {
  console.log(`  bridge at (${b.x?.toFixed?.(1)}, ${b.z?.toFixed?.(1)}) keys=${Object.keys(b).slice(0, 12).join(',')}`);
}

// Where is each stranded node relative to the rail? Inside or outside the loop?
const p = new Vector3();
console.log('\nstranded nodes, vs the railway:');
for (const n of stranded) {
  const d = route.distanceNear(n.x, n.z);
  route.pointAt(d, p);
  const gap = Math.hypot(n.x - p.x, n.z - p.z);
  const radius = Math.hypot(n.x, n.z);
  const railRadius = Math.hypot(p.x, p.z);
  console.log(
    `  (${n.x.toFixed(1)}, ${n.z.toFixed(1)}) space=${n.space} railGap=${gap.toFixed(1)} ` +
      `railD=${d.toFixed(0)} r=${radius.toFixed(1)} railR=${railRadius.toFixed(1)} ` +
      `${radius > railRadius ? 'OUTSIDE the loop' : 'inside'}`,
  );
}

// And the reachable ones, for contrast: how many are outside the loop?
let outside = 0, inside = 0;
for (const n of graph.nodes.filter((x) => x.reachable)) {
  const d = route.distanceNear(n.x, n.z);
  route.pointAt(d, p);
  if (Math.hypot(n.x, n.z) > Math.hypot(p.x, p.z)) outside += 1; else inside += 1;
}
console.log(`\nreachable nodes: ${inside} inside the loop, ${outside} outside it`);

// Why is each pocket cut off? Nearest reachable node, and what blocks the line.
const MAX_EDGE = 13;
const PLAYER_R = 0.45;
const reachableNodes = graph.nodes.filter((n) => n.reachable);
console.log('\nwhat separates each stranded node from the main component:');
for (const n of stranded) {
  const near = reachableNodes
    .map((m) => ({ m, d: Math.hypot(m.x - n.x, m.z - n.z) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, 3);
  const parts: string[] = [];
  for (const { m, d } of near) {
    if (d > MAX_EDGE) { parts.push(`(${m.x.toFixed(1)},${m.z.toFixed(1)}) ${d.toFixed(1)}m TOO FAR`); continue; }
    // walk the line, find the first blocked sample
    let blockedAt = '';
    const steps = Math.ceil(d / 0.5);
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      const x = n.x + (m.x - n.x) * t;
      const z = n.z + (m.z - n.z) * t;
      if (!collision.isClearCircle(x, z, PLAYER_R)) {
        const rd = route.distanceNear(x, z);
        route.pointAt(rd, p);
        blockedAt = `blocked at (${x.toFixed(1)},${z.toFixed(1)}) railGap=${Math.hypot(x - p.x, z - p.z).toFixed(1)}`;
        break;
      }
    }
    parts.push(`(${m.x.toFixed(1)},${m.z.toFixed(1)}) ${d.toFixed(1)}m ${blockedAt || 'CLEAR?!'}`);
  }
  console.log(`  (${n.x.toFixed(1)}, ${n.z.toFixed(1)}): ${parts.join(' | ')}`);
}

// Where can a child actually get across the fence? March the loop, and at each
// rail distance ask whether the line from +6 m outside to -6 m inside is clear.
console.log('\nfence permeability, marched along the loop:');
const t = new Vector3();
const openRuns: string[] = [];
let runStart: number | null = null;
for (let d = 0; d < route.length; d += 2) {
  route.pointAt(d, p);
  route.tangentAt(d, t);
  const nx = t.z, nz = -t.x;
  let clear = true;
  for (let s = -6; s <= 6; s += 0.5) {
    if (!collision.isClearCircle(p.x + nx * s, p.z + nz * s, PLAYER_R)) { clear = false; break; }
  }
  if (clear && runStart === null) runStart = d;
  if (!clear && runStart !== null) { openRuns.push(`${runStart.toFixed(0)}-${(d - 2).toFixed(0)}`); runStart = null; }
}
if (runStart !== null) openRuns.push(`${runStart.toFixed(0)}-${(route.length).toFixed(0)}`);
console.log(`  crossable rail distances: ${openRuns.join(', ') || '(none)'}`);
console.log(`  bridge sites at ${CROSSING_SITES.map((s) => s.railDistance.toFixed(0)).join(', ')}; level sites at ${LEVEL_CROSSING_SITES.map((s) => s.railDistance.toFixed(0)).join(', ')}`);
console.log(`  NW pocket spans railD 309-325; SE pocket spans railD 191-197`);

// Name the blocker by its geometry: which registered collider covers the point?
console.log('\nwhat exactly blocks the pocket boundary:');
const anyCollision = collision as any;
const circles = anyCollision.circles as { x: number; z: number; radius: number; topHeight: number }[];
const walls = anyCollision.walls as { x1: number; z1: number; x2: number; z2: number; halfThickness: number; topHeight: number }[];
console.log(`  ${circles.length} circle colliders, ${walls.length} wall colliders`);
const describe = (x: number, z: number): string => {
  const hits: string[] = [];
  for (const c of circles)
    if (Math.hypot(x - c.x, z - c.z) < c.radius + PLAYER_R)
      hits.push(`circle r=${c.radius.toFixed(1)} top=${c.topHeight.toFixed(1)} at (${c.x.toFixed(1)},${c.z.toFixed(1)})`);
  for (const w of walls) {
    const dx = w.x2 - w.x1, dz = w.z2 - w.z1;
    const len2 = dx * dx + dz * dz || 1;
    const tt = Math.max(0, Math.min(1, ((x - w.x1) * dx + (z - w.z1) * dz) / len2));
    const gx = w.x1 + dx * tt, gz = w.z1 + dz * tt;
    if (Math.hypot(x - gx, z - gz) < w.halfThickness + PLAYER_R)
      hits.push(`wall len=${Math.hypot(dx, dz).toFixed(1)} halfT=${w.halfThickness.toFixed(2)} top=${w.topHeight.toFixed(1)} (${w.x1.toFixed(1)},${w.z1.toFixed(1)})-(${w.x2.toFixed(1)},${w.z2.toFixed(1)})`);
  }
  return hits.join(' + ') || 'nothing?!';
};
for (const [x, z] of [[-43.6, 15.1], [-42.9, 20.3], [-33.7, 33.0], [33.3, -39.8], [33.6, -40.6], [32.2, -35.3]] as const)
  console.log(`  (${x}, ${z}): ${describe(x, z)}`);

// Is the pocket ground genuinely sealed, or just under-seeded with waypoints?
// Flood fill the walkable plane on a 0.5 m grid from a node we know is in the
// main component, and see whether the fill reaches each stranded node.
console.log('\nflood fill from the main component (0.5 m grid):');
const CELL = 0.5;
const start = reachableNodes[0]!;
const key = (i: number, j: number) => i * 100000 + j;
const seen = new Set<number>();
const queue: [number, number][] = [[Math.round(start.x / CELL), Math.round(start.z / CELL)]];
seen.add(key(queue[0]![0], queue[0]![1]));
let filled = 0;
while (queue.length) {
  const [i, j] = queue.pop()!;
  filled += 1;
  if (filled > 400000) break;
  for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    const ni = i + di, nj = j + dj;
    const k = key(ni, nj);
    if (seen.has(k)) continue;
    const x = ni * CELL, z = nj * CELL;
    if (Math.abs(x) > 120 || Math.abs(z) > 120) continue;
    if (!collision.isClearCircle(x, z, PLAYER_R)) continue;
    seen.add(k);
    queue.push([ni, nj]);
  }
}
console.log(`  filled ${filled} cells from (${start.x.toFixed(1)}, ${start.z.toFixed(1)})`);
let reached = 0;
for (const n of stranded) {
  const hit = seen.has(key(Math.round(n.x / CELL), Math.round(n.z / CELL)));
  if (hit) reached += 1;
  console.log(`  (${n.x.toFixed(1)}, ${n.z.toFixed(1)}): ${hit ? 'GROUND IS WALKABLE — waypoint graph fault' : 'genuinely sealed off'}`);
}
console.log(`\n  ${reached}/${stranded.length} stranded waypoints stand on ground the fill reaches.`);

// CONTROL: the fill is ground-level and cannot climb a bridge deck. If it also
// fails to reach the reachable nodes that lie outside the loop, then it is only
// measuring "inside the loop" and proves nothing about the pockets.
let outsideReached = 0, outsideTotal = 0, insideMissed = 0;
for (const n of reachableNodes) {
  const d2 = route.distanceNear(n.x, n.z);
  route.pointAt(d2, p);
  const isOutside = Math.hypot(n.x, n.z) > Math.hypot(p.x, p.z);
  const hit = seen.has(key(Math.round(n.x / CELL), Math.round(n.z / CELL)));
  if (isOutside) { outsideTotal += 1; if (hit) outsideReached += 1; }
  else if (!hit) insideMissed += 1;
}
console.log(`  CONTROL: the fill reaches ${outsideReached}/${outsideTotal} reachable nodes OUTSIDE the loop`);
console.log(`  CONTROL: ${insideMissed} reachable nodes INSIDE the loop the fill missed`);
