import { Vector3 } from 'three';
import { TRAIN_PLAN } from './plan';
import {
  solveCrossingSites,
  type CrossingSite,
  type SolvedCrossingSites,
} from './crossingPlanSolve';
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
  maxCrossingDemands,
  type CrossingSite,
  type SolvedCrossingSites,
} from './crossingPlanSolve';

const SOLVED = takePrewarmedCrossingSites() ?? solveCrossingSites();

/**
 * Every point on the loop where a bridge provably fits — the places
 * `paths.ts` prefers for any leg that must cross the railway.
 *
 * **This is a live binding, and the converge loop is the only thing allowed to
 * move it.** It starts at the solve for an *empty* demand set, which is exactly
 * what this module always computed and is what the fourteen pool seeds that
 * foul nothing keep for ever — their byte-identity is not a claim about a code
 * path, it is the observation that no re-solve happens at all.
 *
 * On a seed where a committed path is measured crossing the railway somewhere
 * no bridge was proven, {@link resolveCrossingSites} replaces it with the solve
 * for the demand set that foul produced, and the loop tries the paths again.
 * Importers see the new value because ESM bindings are live; nobody outside
 * this module can assign it.
 */
export let CROSSING_SITES: readonly CrossingSite[] = SOLVED.bridges;

/**
 * **Has the site list stopped moving?**
 *
 * False from module load until the path solve converges. It is not a cache
 * protocol — there is deliberately nothing here to invalidate — it is the one
 * fact a consumer needs before it may derive anything durable from the site
 * list, and {@link assertCrossingSitesPublished} is how it asks.
 */
let published = false;

/**
 * Re-solve the site plan for a demand set, and hand back what happened.
 *
 * Called only by the converge loop. It is a **pure function of the demands**
 * (contract point 1): nothing is added to the list that is already here, the
 * whole list is solved again from the fixed inputs plus the demands, which is
 * what makes staleness impossible rather than merely unlikely.
 */
export function resolveCrossingSites(demands: readonly number[]): SolvedCrossingSites {
  const solved = solveCrossingSites(demands);
  CROSSING_SITES = solved.bridges;
  return solved;
}

/**
 * The loop calls this once, when the demand set has stopped changing and the
 * committed routes foul nothing. After it, {@link CROSSING_SITES} is final.
 */
export function publishCrossingSites(): void {
  published = true;
}

/**
 * **Refuse to answer if the site list could still move.**
 *
 * The recovery contract's point 6, and the reason it is phrased as an
 * invariant rather than a cache protocol: `bridgeKeepout.ts` memoises the
 * bridge footprints on first query, and if the crossing set could change after
 * that memo was filled, the memo would be a stale read of a list that no longer
 * exists. Rather than teaching it to notice — a second definition of freshness
 * beside this one, kept in step by hand, which is this repo's most expensive
 * habit — **the memo is made impossible to compute early**. Anything durable
 * derived from the site list asks this first and throws if the answer is no.
 *
 * A throw here means a consumer ran before the path solve converged, which is
 * an ordering bug in the build, not a condition to recover from.
 */
export function assertCrossingSitesPublished(who: string): void {
  if (published) return;
  throw new Error(
    `${who} asked for the crossing sites before the path solve published them. ` +
      'CROSSING_SITES is solved from the demand set the committed paths produce, so ' +
      'anything derived from it before the loop converges describes a site list that ' +
      'may not survive. Build the path graph first (pathGraph.ts), which publishes.',
  );
}

/** For instruments and the deliberate-break proof: has the loop published yet? */
export function crossingSitesArePublished(): boolean {
  return published;
}

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
