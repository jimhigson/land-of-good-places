/**
 * Diagnostic: how many measured crossings actually got a built bridge, and
 * where are the track centre-line points a child can stand on?
 *
 * The brief's question is "how many crossings are there and how many are
 * bridged" — a park that builds is not a park whose crossings are bridged.
 */
import './headless-canvas.mjs';

const { buildHeadlessPark } = await import('./park-harness.mts');
const seed = process.env['LGP_SEED'] ?? 'default(canonical)';

const park = buildHeadlessPark();
const { computeCrossings } = await import('../src/world/train/crossings.ts');
const { TRAIN_PLAN } = await import('../src/world/train/plan.ts');

const route = TRAIN_PLAN.route;
const crossings = computeCrossings(route);
const bridges = park.world.train.bridges;

let bridged = 0;
const lines: string[] = [];
for (const c of crossings) {
  const on = bridges.some((b) => b.covers(c.x, c.z));
  if (on) bridged += 1;
  lines.push(
    `  crossing railD ${c.railDistance.toFixed(1)} at (${c.x.toFixed(1)}, ${c.z.toFixed(1)}) ` +
      `spine ${c.spine.length} pts, pathHalfWidth ${c.pathHalfWidth.toFixed(2)} — ` +
      `${on ? 'BRIDGED' : 'NO BRIDGE BUILT'}`,
  );
}
console.log(`seed ${seed}: ${crossings.length} crossings, ${bridged} bridged, ${bridges.length} bridges built`);
for (const line of lines) console.log(line);

// CONTROL on the instrument: `covers` must be capable of saying no. A point
// 40 m off every crossing, and each crossing's own point offset 40 m, must
// come back uncovered — otherwise `covers` is a function that always says yes
// and every BRIDGED above means nothing.
let falsePositives = 0;
for (const c of crossings) {
  if (bridges.some((b) => b.covers(c.x + 40, c.z + 40))) falsePositives += 1;
}
console.log(
  `  control: ${falsePositives} of ${crossings.length} crossings report BRIDGED 40 m off their own centre ` +
    `(must be 0, else 'covers' cannot say no)`,
);
