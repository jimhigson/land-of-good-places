/**
 * Where the Sky Cruiser's sliced solve spends time *outside* the search.
 *
 * The search itself is spread a joint at a time by `ParkGeneration`, so what
 * decides whether a frame hitches is the two lumps either side of it: building
 * the brief, and finishing the plan once a route exists. Both run inside one
 * `advance()`, so both are measured against `GENERATION_BUDGET_MS * 3`.
 */
import { performance } from 'node:perf_hooks';
import { railRouteSearch } from '../src/world/rail/generate.ts';
import { cruiserBriefs, finishCruiserPlan } from '../src/world/coaster/solve.ts';

let briefMs = 0;
const briefRuns: number[] = [];
for (let i = 0; i < 3; i += 1) {
  const t = performance.now();
  cruiserBriefs();
  briefRuns.push(performance.now() - t);
}
const t0 = performance.now();
const start = cruiserBriefs();
const briefs = start.briefs;
briefMs = performance.now() - t0;
console.log(`brief runs ${briefRuns.map((m) => m.toFixed(1)).join(' / ')} ms`);

const t1 = performance.now();
const search = railRouteSearch(briefs.first);
let joints = 0;
let solved;
for (;;) {
  const step = search.next();
  if (step.done) {
    solved = step.value;
    break;
  }
  joints += 1;
}
const searchMs = performance.now() - t1;

// One finish only: `finishCruiserPlan` draws `hillPhase` from `start.rng`, so
// building the route twice off the same stream would give the second one a
// different height profile — a misleading measurement, not a second opinion.
const t3 = performance.now();
const plan = finishCruiserPlan(solved, start.rng);
const finishMs = performance.now() - t3;

console.log(`brief   ${briefMs.toFixed(1)} ms  (${briefs.first.startPoses.length} start poses)`);
console.log(`search  ${searchMs.toFixed(1)} ms  (${joints} yields, satisfied=${solved.report.satisfied})`);
console.log(`finish  ${finishMs.toFixed(1)} ms  (curve ${plan.route.length.toFixed(2)} m)`);
console.log(`total   ${(briefMs + searchMs + finishMs).toFixed(1)} ms`);
