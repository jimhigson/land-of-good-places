import {
  BRIDGE_RAMP_GRADIENT,
  DECK_HALF_LENGTH,
  MIN_RAMP_RUN,
} from './bridgeFootprint';
import { BRIDGE_RISE, FENCE_OFFSET, NARROW_HALF_WIDTH, SITE_HALF_WIDTH } from './clearance';

// Re-exported so this module stays the one place a caller has to look for the
// bridge-fit vocabulary, even though the numbers themselves live with the
// park's other clearances.
export { NARROW_HALF_WIDTH, SITE_HALF_WIDTH };
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
 * **The margin the path screen adds round a site's proven reach** — the
 * difference between "the bridge's own ground" and "ground no foreign ribbon
 * may touch".
 *
 * It lives here, with the other shared thresholds, because **two modules have
 * to agree about the same rectangle**: `paths.ts` forbids
 * `DECK_HALF_LENGTH + rampReach + this` by `halfWidth + this` to every leg that
 * is not the crossing's own, and `crossingPlanSolve.ts`'s `footprintsOverlap`
 * has to refuse two sites whose *those* rectangles overlap. A copy of the
 * number in either place is the drift that produced seed 288's dangling bridge
 * (see `footprintsOverlap`).
 */
export const RAMP_SCREEN_MARGIN = 0.5;

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

/**
 * Clearance a ground-level ramp tread keeps from the rail centre line —
 * `bridgeFootprint.ts`'s own `FENCE_OFFSET + RAMP_RAIL_MARGIN`, restated from
 * the same parts because that sum is module-private there. Matters on the
 * oblique candidates, whose ramps skirt the fence at an angle.
 *
 * Lives here rather than in `crossingPlanSolve.ts` because **two callers now
 * apply it**: the crossing planner, against the solved loop it is measuring,
 * and `train/route.ts`'s `satisfies` backstop, against a candidate loop that
 * has only just closed. One number, one owner — see this module's header.
 */
export const SITE_RAIL_MARGIN = FENCE_OFFSET + 0.5;

/**
 * **A ramp may not run inside the railway's own corridor.**
 *
 * Past the deck a ramp is ordinary near-ground paving, so a ramp beside the
 * rails is a ramp in the four-foot; the obliques are the ones that skirt it.
 * Only past {@link DECK_HALF_LENGTH}, because the deck is *over* the railway by
 * definition and that is the whole point of it.
 *
 * A factory, and shared, because the two callers differ only in which route
 * they measure against. `crossingPlanSolve.ts` asks it of the solved
 * `TRAIN_PLAN.route`; `train/route.ts`'s `satisfies` backstop asks it of a
 * candidate loop that has only just closed and is not yet anybody's plan. The
 * *rule* is the same one in both, and it is this one.
 */
export function railCorridorBlocked(railDistanceAt: (x: number, z: number) => number): ExtraBlocked {
  return (x, z, along) => along > DECK_HALF_LENGTH && railDistanceAt(x, z) < SITE_RAIL_MARGIN;
}

/**
 * Candidate crossing angles, radians off square, in preference order — square
 * first (the network is predominantly grid-aligned and a crossing reads best
 * square to the track; Decision 6 keeps diagonals a genuine minority), modest
 * obliques after, for stretches where the ground past the rail is too shallow
 * for a straight ramp but has room along its length.
 */
export const SITE_ANGLE_OFFSETS: readonly number[] = [
  0,
  Math.PI / 6,
  -Math.PI / 6,
  Math.PI / 4,
  -Math.PI / 4,
];

/** Deck half-widths tried, widest first. */
export const SITE_HALF_WIDTHS: readonly number[] = [SITE_HALF_WIDTH, NARROW_HALF_WIDTH];

/** The first width and angle at which a whole bridge fits across the track. */
export interface BridgeFitAcross {
  readonly halfWidth: number;
  readonly dirX: number;
  readonly dirZ: number;
  readonly rampReachPos: number;
  readonly rampReachNeg: number;
  /** Radians off square, signed. 0 is perpendicular to the track. */
  readonly angleOffset: number;
}

/**
 * **Does a whole bridge fit across the track here?** — the width/angle search
 * both callers run, in one place.
 *
 * `perpX`/`perpZ` is the square-across direction (`crossings.ts`'s `side = +1`
 * convention). Widths are tried widest-first and angles square-first, and the
 * first pair whose deck fits and whose ramps both reach {@link SITE_RAMP_FLOOR}
 * wins — so the returned fit is the *preferred* one, not merely a possible one.
 *
 * `extraBlocked` is whatever the caller knows beyond the boundary and the
 * plots. The crossing planner passes the station-structure and rail-corridor
 * tests; the start-pose generator passes none (there is no route yet); the
 * `satisfies` backstop passes the rail-corridor test alone, because at that
 * moment there is a route but not yet any stations.
 */
export function fitBridgeAcross(
  centreX: number,
  centreZ: number,
  perpX: number,
  perpZ: number,
  extraBlocked?: ExtraBlocked,
  /**
   * **How much ramp each side must prove.** {@link SITE_RAMP_FLOOR} — the real
   * acceptance bar plus one stride of planning slack — for every ordinary
   * candidate, and that is the default so no caller can drift off it by
   * omission.
   *
   * A caller may pass {@link MIN_RAMP_RUN} instead, and exactly one does: the
   * second-tier pass in `crossingPlanSolve.ts` that runs only when the first
   * tier proved no site at all near the park's own gate. That is a backtrack
   * ladder, not a lower floor — see its own comment for the measurement, and
   * note that the slack it gives up is *planning* slack, so what it accepts is
   * still a bridge `bridgeFootprint.ts` will really build.
   */
  rampFloor: number = SITE_RAMP_FLOOR,
): BridgeFitAcross | null {
  for (const halfWidth of SITE_HALF_WIDTHS) {
    for (const angleOffset of SITE_ANGLE_OFFSETS) {
      const cos = Math.cos(angleOffset);
      const sin = Math.sin(angleOffset);
      const dirX = perpX * cos + perpZ * sin;
      const dirZ = -perpX * sin + perpZ * cos;
      const { pos, neg, deckClear } = probeBridgeReach(
        centreX,
        centreZ,
        dirX,
        dirZ,
        halfWidth,
        SITE_RAMP_IDEAL,
        SITE_BOUNDARY_MARGIN,
        SITE_PLOT_MARGIN,
        extraBlocked,
      );
      if (!deckClear || pos < rampFloor || neg < rampFloor) continue;
      return { halfWidth, dirX, dirZ, rampReachPos: pos, rampReachNeg: neg, angleOffset };
    }
  }
  return null;
}
