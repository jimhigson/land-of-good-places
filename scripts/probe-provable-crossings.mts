/**
 * **Every rail distance on the loop where a bridge provably fits**, as runs.
 *
 * `crossingPlanSolve` marches at 2 m and then *spaces* what it finds 24 m
 * apart, so the published site list says nothing about where a bridge COULD
 * have gone. This does: it asks `provableCrossingAt` at every metre and prints
 * the runs. That is the difference between "the solver did not pick a site
 * here" and "no site is possible here", and the recovery loop's whole second
 * rung turns on which of those is true.
 *
 * Used to establish that seed 288's station-1 pocket — bounded by the loop at
 * railD 24-51 and 194-220 — contains no provable crossing anywhere on its
 * boundary, so no demand can ever serve it.
 */
import { TRAIN_PLAN } from '../src/world/train/plan.ts';
import { provableCrossingAt } from '../src/world/train/crossingPlanSolve.ts';
const route = TRAIN_PLAN.route;
const runs: string[] = [];
let start: number | null = null;
for (let d = 0; d < route.length; d += 1) {
  const ok = provableCrossingAt(d) !== null;
  if (ok && start === null) start = d;
  if (!ok && start !== null) { runs.push(`${start}-${d - 1}`); start = null; }
}
if (start !== null) runs.push(`${start}-${Math.floor(route.length)}`);
console.log(`seed ${process.env['LGP_SEED']}: loop ${route.length.toFixed(1)} m. Rail distances where a bridge PROVES:`);
console.log('  ' + (runs.join('   ') || '(nowhere)'));
