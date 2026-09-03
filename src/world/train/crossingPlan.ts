import { solveCrossingSites, type CrossingSite } from './crossingPlanSolve';
import { takePrewarmedCrossingSites } from './crossingPrewarm';

/**
 * **Where the park may cross its own railway — planned first, not
 * discovered afterwards.** The solving machinery (and its full rationale)
 * lives in `crossingPlanSolve.ts`, split out so the boot can drive it a
 * slice at a time (`crossingPrewarm.ts`) without this module's own load
 * triggering the whole ~300 ms march synchronously; in Node and the
 * harness, where nobody pre-warms, it solves straight through here exactly
 * as it always did.
 */
export {
  NARROW_HALF_WIDTH,
  SITE_HALF_WIDTH,
  SITE_RAMP_FLOOR,
  SITE_RAMP_IDEAL,
  type CrossingSite,
  type SolvedCrossingSites,
} from './crossingPlanSolve';

const SOLVED = takePrewarmedCrossingSites() ?? solveCrossingSites();

/**
 * Every point on the loop where a bridge provably fits — the places
 * `paths.ts` prefers for any leg that must cross the railway. Solved once,
 * at module load, from the same fixed inputs the rail and plot solvers used.
 */
export const CROSSING_SITES: readonly CrossingSite[] = SOLVED.bridges;

/**
 * Which side of the railway a point stands on — **moved to
 * `crossingPlanSolve.ts` and re-exported here**, so every consumer keeps
 * importing it from where it always did.
 *
 * It moved because the solver itself needs the answer: its second-tier gate
 * pass asks whether the park's gate and the park's middle are on opposite
 * sides of the loop, and a copy of this arithmetic living there would be a
 * second definition of "which side" able to drift from this one — the
 * commonest bug in this repo. Importing it back from this module would be a
 * cycle, since this module is what runs the solve.
 */
export { railSideOf } from './crossingPlanSolve';
