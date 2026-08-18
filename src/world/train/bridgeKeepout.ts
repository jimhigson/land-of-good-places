import { TRAIN_PLAN } from './plan';
import { computeCrossings } from './crossings';
import { planBridgeFootprints, type BridgeFootprint } from './bridgeFootprint';

/**
 * Where a bridge's deck and ramps will stand — computed lazily, on first
 * real query, exactly the same trick `train/plan.ts`'s
 * `distanceToRailCorridor` already plays for the rail corridor itself.
 * `ParkTrain` does not exist yet at that point in the build, only its
 * *plan* does, but `computeCrossings` needs only the solved route and the
 * drawn path centreline, and `planBridgeFootprints` needs only that
 * crossing list — nothing about either needs a real `Bridge`.
 *
 * **Deliberately NOT computed at module load**, despite `TRAIN_PLAN` itself
 * being settled then — `pathCentreline()` (`paths.ts`) is a *function*
 * backed by a mutable array that `Garden`'s constructor fills in at
 * runtime (`buildPaths()`), not at its own module's evaluation time. A
 * top-level call here ran before a single park had ever called `new
 * Garden(...)`, so it always saw an **empty** centreline — every
 * path-crossing touch silently missing, only the hand-added gate-walk
 * samples surviving — and produced a crossing list that quietly disagreed
 * with the one `ParkTrain` computes for real, built last, against the
 * fully-populated centreline. Found on seed 5 (issue #116): a garden bench
 * built 0.66 m from a live ramp, because this file's own footprint for
 * that crossing did not cover the point the *real* bridge's `covers()`
 * agreed was on it. Fixed by deferring the computation to first call
 * instead — `Scenery`'s own wall/tree placement is exactly where that
 * first call happens, and `Garden` (which owns `buildPaths()`) always
 * builds before `Scenery` in `World`'s own build order, so by then the
 * centreline this reads is the real, finished one.
 *
 * **Why this file exists at all.** `Scenery.ts`'s own `onRailway` already
 * kept trees off the narrow rail corridor (the fence's own 2 m either
 * side); nothing kept them off a bridge's much longer ramp, because
 * nothing built before #116 reached that far from the rail. A lamp post
 * planted 6 m out (ordinary distance for a scattered prop, comfortably
 * clear of the *old* corridor) landed square in a ramp's low end, and a
 * `poiGraph` probe standing on the ramp there was pushed off it — found by
 * `test/procgen/invariants.ts`'s `everyBridgeIsWalkableAndReachable`, not
 * by eye, which is exactly the kind of thing that check exists to catch.
 */
let footprintsCache: readonly BridgeFootprint[] | null = null;

function footprints(): readonly BridgeFootprint[] {
  if (footprintsCache) return footprintsCache;
  const crossings = computeCrossings(
    TRAIN_PLAN.route,
    TRAIN_PLAN.stations.map((station) => station.distance),
  );
  footprintsCache = planBridgeFootprints(crossings);
  return footprintsCache;
}

/**
 * Padding past the bridge's own exact edge, for keepout purposes only (see
 * `BridgeFootprint.covers()`'s own doc comment on why the padding lives
 * here and not on the footprint itself). Sized off what an ordinary
 * decorative collider actually needs clear: the widest wall half-thickness
 * in `Scenery.ts` (stone, 0.34 m) plus `PLAYER_RADIUS` (0.62 m) is 0.96 m of
 * genuine overlap risk — a relative-`topHeight` wall built that close still
 * reaches a probe standing on the ramp above it, regardless of the probe's
 * real elevation (issue #116, seed 5). A full 2 m — the same "stride of
 * slack" `ACROSS_MARGIN` and `RAMP_CLEARANCE` already use elsewhere in this
 * feature — clears that with room to spare rather than trimming to the
 * minimum and re-discovering the edge on the next seed.
 */
const KEEPOUT_MARGIN = 2.0;

/** True if `(x, z)` is on, or near, some bridge's deck or ramp — padded past
 * the bridge's own exact edge so nothing solid ends up built close enough to
 * still reach a probe standing on it. `margin` defaults to
 * {@link KEEPOUT_MARGIN}, sized for the widest thing this file guards
 * against (a stone wall); a caller whose own object is smaller and does not
 * need that much clearance may pass a tighter one — see
 * `LampPosts.ts`'s own call for why a lamp does. */
export function isInBridgeFootprint(x: number, z: number, margin = KEEPOUT_MARGIN): boolean {
  for (const footprint of footprints()) {
    if (footprint.covers(x, z, margin)) return true;
  }
  return false;
}
