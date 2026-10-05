import { GARDEN_PLAY_BOUNDARY } from '../../../src/world/boundary';
import { clearOfPlots } from '../../../src/world/parkLayout';
import { DECK_HALF_LENGTH } from '../../../src/world/train/bridgeFootprint';
import { SITE_ANGLE_OFFSETS, SITE_BOUNDARY_MARGIN, SITE_HALF_WIDTHS, SITE_PLOT_MARGIN, SITE_RAIL_MARGIN, SITE_RAMP_FLOOR, SITE_RAMP_IDEAL, type BridgeFitAcross, type BridgeReach, type ExtraBlocked } from '../../../src/world/train/bridgeFit';
/**
 * **Does a bridge fit here?** — the marching probe the crossing-site search
 * and the loop's pose generator share. Moved verbatim from
 * `src/world/train/bridgeFit.ts`. Build-time only.
 */

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
      if (!deckClear || pos < SITE_RAMP_FLOOR || neg < SITE_RAMP_FLOOR) continue;
      return { halfWidth, dirX, dirZ, rampReachPos: pos, rampReachNeg: neg, angleOffset };
    }
  }
  return null;
}
