import {
  BRIDGE_RAMP_GRADIENT,
  DECK_HALF_LENGTH,
  MIN_RAMP_RUN,
} from './bridgeFootprint';
import { BRIDGE_RISE } from './clearance';
import { GARDEN_PLAY_BOUNDARY } from '../boundary';
import { clearOfPlots } from '../parkLayout';

/**
 * **Does a bridge fit here? — the geometry, asked without a railway.**
 *
 * This is the shared core of the one question `crossingPlanSolve.ts` has
 * always asked ("a deck plus a walkable ramp on both sides, against the
 * boundary and the plots") — extracted so it can also be asked *before a rail
 * route exists*, which is what issue #427 needs: the loop is grown through a
 * crossing pose chosen up front, so the pose has to be proven bridgeable
 * while the railway is still the thing being placed.
 *
 * ## One core, two callers, and why they must not drift
 *
 * Issue #414 began as a disagreement between a prover and a builder: the
 * planner proved no bridge fits somewhere, the late pass built one anyway, and
 * the path network had been laid out for the world without it. **A second,
 * more permissive copy of "a bridge fits here" would recreate exactly that**,
 * one level earlier — the start-pose generator would hand the search poses the
 * real planner later rejects, and every such loop would come out with a
 * crossing it cannot bridge.
 *
 * So there is one marching probe, here, and the caller supplies whatever extra
 * it knows about. `crossingPlanSolve.ts` passes the two tests that need a
 * solved route; the pose generator passes none. The margins, the sample
 * pattern, the reach-marching and `DECK_HALF_LENGTH` are shared and are not
 * restated anywhere.
 *
 * ## What the route-free caller keeps, drops, and why
 *
 * **Kept** — the boundary margin, the plot margin, the deck-and-both-ramps
 * shape, the sample pattern across the corridor, and the reach march. These
 * are the whole of the geometric question and none of them mentions a railway.
 *
 * **Dropped: the rail-corridor test.** `crossingPlanSolve.ts` refuses a ramp
 * that runs inside the rail's own corridor, because there the rail is fixed
 * and a ramp beside it is a ramp in the four-foot. Here the rail does not
 * exist yet and will be laid *through* this pose, perpendicular to the ramp —
 * so the test has nothing to measure and asking it would be meaningless, not
 * lenient.
 *
 * **Dropped: the station-structure test.** Stations are placed along the
 * solved route afterwards (`train/plan.ts`), so there are none to stand clear
 * of. **This one genuinely is a relaxation**, and it is the one to watch: a
 * pose accepted here can later have a station land near it and be rejected by
 * the real planner. That is survivable because the pose generator offers a
 * ranked field rather than a single pose — the search moves to the next
 * candidate — but if a measurable share of loops come out unbridgeable, this
 * is the first place to look.
 */
export interface BridgeReach {
  /** Clear reach past the deck along `+dir`, metres. */
  readonly pos: number;
  /** Clear reach past the deck along `-dir`, metres. */
  readonly neg: number;
  /** Did the deck itself fit at all? Both reaches are 0 when it did not. */
  readonly deckClear: boolean;
}

/**
 * An extra reason a point is blocked, beyond the boundary and the plots.
 * `along` is metres from the crossing centre, so a caller can apply a test
 * only past the deck (which is what the rail corridor needs).
 */
export type ExtraBlocked = (x: number, z: number, along: number) => boolean;

/**
 * Memoised boundary distance on a 1 m grid.
 *
 * `distanceToEdge` walks the whole boundary spline per query and this probe
 * asks it tens of thousands of times over overlapping candidate footprints —
 * `check:solve-cost` measured the un-memoised solve at ~940 ms of the paths
 * stage's ~1 s. 1 m is far finer than any margin decided against (1.0-2.0 m),
 * and deterministic.
 *
 * **Shared by both callers on purpose.** The pose generator (#427) sweeps far
 * more candidate points than the crossing planner ever did, over the same
 * ground, so it wants this cache more than the original caller did — and a
 * second cache keyed differently would be a second answer to "how far is the
 * boundary".
 */
const boundaryDistanceCache = new Map<number, number>();
function boundaryDistanceAt(x: number, z: number): number {
  const key = (Math.round(x) + 8192) * 32768 + (Math.round(z) + 8192);
  const hit = boundaryDistanceCache.get(key);
  if (hit !== undefined) return hit;
  const value = GARDEN_PLAY_BOUNDARY.distanceToEdge(x, z);
  boundaryDistanceCache.set(key, value);
  return value;
}

/**
 * ## The thresholds, shared for the same reason the probe is
 *
 * These moved here from `crossingPlanSolve.ts` (which re-exports them, so its
 * own consumers are unchanged) when the probe did. A shared probe run against
 * two different sets of margins would be two different questions wearing one
 * function's name — precisely the drift this module exists to prevent.
 */

/**
 * Same walkable floor the real bridge search accepts at
 * (`bridgeFootprint.ts`'s `WALKABLE_FLOOR + WALKABLE_MARGIN`), plus one
 * extra stride of planning slack — a site that only *just* clears the
 * acceptance bar leaves the late, real pass nothing to spend on the small
 * obstacles (a lamp base, a bush trunk) that legitimately arrive later.
 */
export const SITE_RAMP_FLOOR = MIN_RAMP_RUN + 1.0;
/** The most ramp a site ever needs credit for — the shallow, ideal grade,
 * the same run the real pass starts from. */
export const SITE_RAMP_IDEAL = BRIDGE_RISE / BRIDGE_RAMP_GRADIENT;
/**
 * Half-width of the corridor a bridge site's deck and ramps are probed at.
 * The real pass starts its width search at the crossing's own `halfGap`
 * (floored at 4.5 in `crossings.ts`, and a square planned crossing measures
 * at that floor), so this is the corridor the first — preferred — real
 * candidate will actually occupy, plus half a stride of slack.
 */
export const SITE_HALF_WIDTH = 4.5 + 0.5;
/**
 * The narrower corridor tried when {@link SITE_HALF_WIDTH} finds nothing —
 * a deck for a path that arrives square needs barely more than the ribbon
 * itself, and a whole district with no bridge at all is a far worse
 * outcome than a slimmer one (seed 2's east: plots, a station and the
 * boundary between them ruled out every full-width candidate).
 */
export const NARROW_HALF_WIDTH = 4.0;
/** Boundary / plot margins for a ramp — the early reservation pass's own
 * figures (`bridgeFootprint.ts`'s `RAMP_BOUNDARY_MARGIN` / `RAMP_PLOT_MARGIN`
 * are module-private; same numbers, same job, and drift here only ever makes
 * this planner *stricter* than the reservation, the safe direction). */
export const SITE_BOUNDARY_MARGIN = 1.5;
export const SITE_PLOT_MARGIN = 2.0;

/** Where the corridor is sampled across its width. */
const ACROSS_SAMPLES: readonly number[] = [-1, -0.5, 0, 0.5, 1];

/** Pitch the reach is marched at, metres. */
const REACH_STEP = 0.5;

export function probeBridgeReach(
  centreX: number,
  centreZ: number,
  dirX: number,
  dirZ: number,
  halfWidth: number,
  maxReach: number,
  boundaryMargin: number,
  plotMargin: number,
  extraBlocked?: ExtraBlocked,
): BridgeReach {
  const acrossX = -dirZ;
  const acrossZ = dirX;
  const clearAt = (along: number, sign: 1 | -1): boolean => {
    for (const t of ACROSS_SAMPLES) {
      const x = centreX + dirX * along * sign + acrossX * halfWidth * t;
      const z = centreZ + dirZ * along * sign + acrossZ * halfWidth * t;
      if (boundaryDistanceAt(x, z) < boundaryMargin) return false;
      if (!clearOfPlots(x, z, plotMargin)) return false;
      if (extraBlocked?.(x, z, along)) return false;
    }
    return true;
  };
  const deckClear = clearAt(0, 1) && clearAt(DECK_HALF_LENGTH, 1) && clearAt(DECK_HALF_LENGTH, -1);
  if (!deckClear) return { pos: 0, neg: 0, deckClear };
  const reach = (sign: 1 | -1): number => {
    let run = 0;
    const steps = Math.ceil(maxReach / REACH_STEP);
    for (let i = 1; i <= steps; i += 1) {
      const along = DECK_HALF_LENGTH + (i / steps) * maxReach;
      if (!clearAt(along, sign)) break;
      run = along - DECK_HALF_LENGTH;
    }
    return run;
  };
  return { pos: reach(1), neg: reach(-1), deckClear };
}
