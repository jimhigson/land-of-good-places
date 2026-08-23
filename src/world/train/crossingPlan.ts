import { Vector3 } from 'three';
import { TRAIN_PLAN } from './plan';
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
 * Deliberate, station-clear, square level-crossing sites — Decision 8's
 * rare fallback, offered only where {@link CROSSING_SITES} leaves a whole
 * stretch of the loop unbridgeable. `paths.ts` charges
 * {@link LEVEL_CROSSING_PENALTY} extra metres for picking one, so a bridge
 * always wins when one is anywhere reasonable.
 */
export const LEVEL_CROSSING_SITES: readonly CrossingSite[] = SOLVED.levels;

/**
 * Extra path-metres a level-crossing site costs in `paths.ts`'s site
 * selection — the price of contradicting Decision 8's preference. Sized so
 * a bridge within roughly this much extra walking always wins, and only a
 * genuinely stranded region (nothing bridgeable anywhere near) falls back.
 */
export const LEVEL_CROSSING_PENALTY = 45;

/**
 * Which side of the railway a point stands on, in `crossings.ts`'s own
 * sign convention (+1 along `(tangent.z, -tangent.x)` from the nearest rail
 * point). Well-defined for any point meaningfully off the centre line; the
 * loop is simple (never self-crossing), so the sign is stable park-wide.
 */
const sideScratch = new Vector3();
const sideTangent = new Vector3();

export function railSideOf(x: number, z: number): 1 | -1 {
  const route = TRAIN_PLAN.route;
  const d = route.distanceNear(x, z);
  const p = route.pointAt(d, sideScratch);
  const t = route.tangentAt(d, sideTangent);
  return Math.sign(t.z * (x - p.x) - t.x * (z - p.z)) >= 0 ? 1 : -1;
}
