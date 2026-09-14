/**
 * Diagnostic: for one seed (`LGP_SEED`), does the park build, and how many of
 * its measured rail crossings are drawn and bridged?
 *
 * Prints one machine-readable line so a shell loop can sweep the pool.
 */
import './headless-canvas.mjs';
import { Vector3 } from 'three';

const { buildHeadlessPark } = await import('./park-harness.mts');
const PARK_SEED = process.env['LGP_SEED'] ?? 'default(canonical)';

let thrown: unknown = null;
try {
  buildHeadlessPark();
} catch (error) {
  thrown = error;
}

if (thrown) {
  console.log(`seed ${PARK_SEED}: THREW — ${(thrown as Error).message.split('\n')[0]}`);
  process.exit(0);
}

const { pathCentreline } = await import('../src/world/pathGraph.ts');
const { CROSSING_SITES } = await import('../src/world/train/crossingPlan.ts');
const { TRAIN_PLAN } = await import('../src/world/train/plan.ts');
const { computeCrossings } = await import('../src/world/train/crossings.ts');
const { ENTRANCE_GATE_X, ENTRANCE_GATE_Z } = await import('../src/world/entrance/layout.ts');

const route = TRAIN_PLAN.route;
const crossings = computeCrossings(route);
// Every crossing computeCrossings returns HAS snapped to a site (it throws
// otherwise), so the honest question is a different one: does each one sit on
// a site, measured back from the site list, and does a drawn path run through
// it (a non-empty spine)?
let onSite = 0;
let withSpine = 0;
for (const c of crossings) {
  if (CROSSING_SITES.some((s) => Math.hypot(s.x - c.x, s.z - c.z) < 0.01)) onSite += 1;
  if (c.spine.length >= 2) withSpine += 1;
}

// How far is the nearest drawn paving to the arch?
let nearestToGate = Infinity;
for (const s of pathCentreline()) {
  const d = Math.hypot(s.x - ENTRANCE_GATE_X, s.z - ENTRANCE_GATE_Z) - s.halfWidth;
  if (d < nearestToGate) nearestToGate = d;
}
void new Vector3();

console.log(
  `seed ${PARK_SEED}: BUILT — ${crossings.length} crossings, ${onSite} on a proven site, ` +
    `${withSpine} with a drawn path through them; nearest paving to the arch ` +
    `${nearestToGate.toFixed(1)} m; ${CROSSING_SITES.length} sites planned`,
);
