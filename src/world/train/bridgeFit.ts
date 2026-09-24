import { BRIDGE_RAMP_GRADIENT, MIN_RAMP_RUN } from './bridgeFootprint';
import { BRIDGE_RISE, FENCE_OFFSET, NARROW_HALF_WIDTH, SITE_HALF_WIDTH } from './clearance';

// Re-exported so this module stays the one place a caller has to look for the
// bridge-fit vocabulary, even though the numbers themselves live with the
// park's other clearances.
export { NARROW_HALF_WIDTH, SITE_HALF_WIDTH };

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
/** Boundary / plot margins for a ramp — the early reservation pass's own
 * figures (`bridgeFootprint.ts`'s `RAMP_BOUNDARY_MARGIN` / `RAMP_PLOT_MARGIN`
 * are module-private; same numbers, same job, and drift here only ever makes
 * this planner *stricter* than the reservation, the safe direction). */
export const SITE_BOUNDARY_MARGIN = 1.5;
export const SITE_PLOT_MARGIN = 2.0;

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
