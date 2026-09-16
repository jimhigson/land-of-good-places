/**
 * Diagnostic: where do the drawn paths meet the railway, and which planned
 * bridge sites exist?
 *
 * Builds the real park (catching the crossings throw, which happens after
 * `buildPaths()` has run, so `pathCentreline()` is live either way), then
 * re-derives the flip set exactly as `computeCrossings` does and prints it
 * beside `CROSSING_SITES`.
 *
 * CONTROL: it must reproduce the production throw's own railD/point. If it
 * does not, the instrument is measuring something else and nothing it says
 * may be believed.
 */
import '../scripts/headless-canvas.mjs';
import { Vector3 } from 'three';

const { buildHeadlessPark } = await import('./park-harness.mts');

let thrown: unknown = null;
try {
  buildHeadlessPark();
} catch (error) {
  thrown = error;
}
console.log('world build:', thrown ? `threw — ${(thrown as Error).message}` : 'ok');

const { pathCentreline } = await import('../src/world/pathGraph.ts');
const { CROSSING_SITES } = await import('../src/world/train/crossingPlan.ts');
const { TRAIN_PLAN } = await import('../src/world/train/plan.ts');
const { ENTRANCE_GATE_X, ENTRANCE_GATE_Z } = await import('../src/world/entrance/layout.ts');

const route = TRAIN_PLAN.route;
const samples = pathCentreline();
console.log(`path centreline samples: ${samples.length}`);
console.log(`rail loop length: ${route.length.toFixed(1)} m`);
console.log(`gate: (${ENTRANCE_GATE_X.toFixed(2)}, ${ENTRANCE_GATE_Z.toFixed(2)})`);
console.log(`CROSSING_SITES: ${CROSSING_SITES.length}`);
for (const site of CROSSING_SITES) {
  console.log(
    `  site railD ${site.railDistance.toFixed(1)} at (${site.x.toFixed(1)}, ${site.z.toFixed(1)}) ` +
      `dir (${site.dirX.toFixed(2)}, ${site.dirZ.toFixed(2)}) halfWidth ${site.halfWidth.toFixed(2)}`,
  );
}

// ---- re-derive flips, same rules as computeCrossings ----
const TOUCH_DISTANCE = 3.2;
const RUN_BREAK = 3;
const CLUSTER_GAP = 8;
const point = new Vector3();
const tangent = new Vector3();
const flips: { d: number; source: string }[] = [];
let previous: { x: number; z: number; railDistance: number; side: number; perp: number } | null =
  null;
let source = 'drawn';
const consider = (x: number, z: number) => {
  const railDistance = route.distanceNear(x, z);
  route.pointAt(railDistance, point);
  route.tangentAt(railDistance, tangent);
  const perp = Math.hypot(point.x - x, point.z - z);
  const side = Math.sign(tangent.z * (x - point.x) - tangent.x * (z - point.z)) || 1;
  const current = { x, z, railDistance, side, perp };
  if (previous) {
    const stride = Math.hypot(x - previous.x, z - previous.z);
    if (stride < RUN_BREAK && side !== previous.side && Math.min(perp, previous.perp) <= TOUCH_DISTANCE) {
      const half = route.length / 2;
      const delta = route.wrap(railDistance - previous.railDistance + half) - half;
      flips.push({ d: route.wrap(previous.railDistance + delta / 2), source });
    }
  }
  previous = current;
};
for (const sample of samples) consider(sample.x, sample.z);

source = 'esplanade';
previous = null;
const inX = -ENTRANCE_GATE_X / Math.hypot(ENTRANCE_GATE_X, ENTRANCE_GATE_Z);
const inZ = -ENTRANCE_GATE_Z / Math.hypot(ENTRANCE_GATE_X, ENTRANCE_GATE_Z);
const onDrawnPath = (x: number, z: number): boolean => {
  for (const s of samples) if (Math.hypot(s.x - x, s.z - z) <= s.halfWidth + 0.4) return true;
  return false;
};
let sinceDrawn = -1;
let marched = 0;
for (let step = 0; step <= 32; step += 1) {
  const x = ENTRANCE_GATE_X + inX * step;
  const z = ENTRANCE_GATE_Z + inZ * step;
  if (sinceDrawn >= 0) sinceDrawn += 1;
  else if (step > 0 && onDrawnPath(x, z)) sinceDrawn = 0;
  if (sinceDrawn > 4) break;
  let near = Infinity;
  let nearGap = Infinity;
  for (const s of samples) {
    const d = Math.hypot(s.x - x, s.z - z);
    if (d < near) near = d;
    const gap = d - s.halfWidth;
    if (gap < nearGap) nearGap = gap;
  }
  const railD = route.distanceNear(x, z);
  const rp = route.pointAt(railD, new Vector3());
  console.log(
    `  march step ${step} at (${x.toFixed(1)}, ${z.toFixed(1)}) nearest drawn sample ${near.toFixed(2)} m ` +
      `(edge gap ${nearGap.toFixed(2)}), rail ${Math.hypot(rp.x - x, rp.z - z).toFixed(2)} m`,
  );
  consider(x, z);
  marched = step;
}
console.log(`esplanade march ran to step ${marched} (sinceDrawn ${sinceDrawn})`);

flips.sort((a, b) => a.d - b.d);
console.log(`flips: ${flips.length}`);
let group: typeof flips = [];
const emit = () => {
  if (!group.length) return;
  const first = group[0]!.d;
  const last = group[group.length - 1]!.d;
  const mid = (first + last) / 2;
  const p = route.pointAt(mid, new Vector3());
  let nearest = Infinity;
  let nearestSite = -1;
  for (let i = 0; i < CROSSING_SITES.length; i += 1) {
    const site = CROSSING_SITES[i]!;
    const along = Math.abs(route.wrap(mid - site.railDistance + route.length / 2) - route.length / 2);
    if (along < nearest) {
      nearest = along;
      nearestSite = i;
    }
  }
  const sources = [...new Set(group.map((g) => g.source))].join('+');
  console.log(
    `  crossing railD ${mid.toFixed(1)} at (${p.x.toFixed(1)}, ${p.z.toFixed(1)}) ` +
      `spread ${(last - first).toFixed(1)} from ${sources} — nearest site #${nearestSite} ` +
      `${nearest.toFixed(1)} m away ${nearest <= 8 ? '(SNAPS)' : '(NO SITE)'}`,
  );
  group = [];
};
for (const flip of flips) {
  const last = group[group.length - 1];
  if (last !== undefined && flip.d - last.d > CLUSTER_GAP) emit();
  group.push(flip);
}
emit();
