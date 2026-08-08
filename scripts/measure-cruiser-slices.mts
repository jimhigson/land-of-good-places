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
import { CoasterRoute } from '../src/world/coaster/route.ts';
import { cruiserBriefs, cruiserOptions, finishCruiserPlan } from '../src/world/coaster/solve.ts';

const t0 = performance.now();
const briefs = cruiserBriefs();
const briefMs = performance.now() - t0;

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

const t2 = performance.now();
const bare = new CoasterRoute(cruiserOptions(), solved);
const routeMs = performance.now() - t2;

const t3 = performance.now();
const plan = finishCruiserPlan(solved);
const finishMs = performance.now() - t3;
console.log(`  of which CoasterRoute ctor ${routeMs.toFixed(1)} ms, crest ${bare.crestY.toFixed(2)}`);

console.log(`brief   ${briefMs.toFixed(1)} ms  (${briefs.first.startPoses.length} start poses)`);
console.log(`search  ${searchMs.toFixed(1)} ms  (${joints} yields, satisfied=${solved.report.satisfied})`);
console.log(`finish  ${finishMs.toFixed(1)} ms  (curve ${plan.route.length.toFixed(2)} m)`);
console.log(`total   ${(briefMs + searchMs + finishMs).toFixed(1)} ms`);
