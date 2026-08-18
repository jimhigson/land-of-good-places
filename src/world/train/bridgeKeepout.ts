import { TRAIN_PLAN } from './plan';
import { computeCrossings } from './crossings';
import { planBridgeFootprints } from './bridgeFootprint';

/**
 * Where a bridge's deck and ramps will stand, decided at module load —
 * before `Scenery` or `LampPosts` scatter anything, exactly the same trick
 * `train/plan.ts`'s `distanceToRailCorridor` already plays for the rail
 * corridor itself. `ParkTrain` does not exist yet at this point in the
 * build, only its *plan* does, but `computeCrossings` needs only the solved
 * route and the drawn path centreline — both already settled at module
 * load (`TRAIN_PLAN`, `paths.ts`'s own `PATH_GRAPH`) — so the answer is
 * exact, not an approximation to be reconciled once a real bridge exists.
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
const CROSSINGS = computeCrossings(
  TRAIN_PLAN.route,
  TRAIN_PLAN.stations.map((station) => station.distance),
);
const FOOTPRINTS = planBridgeFootprints(CROSSINGS);

/** True if `(x, z)` is on, or will be on, some bridge's deck or ramp. */
export function isInBridgeFootprint(x: number, z: number): boolean {
  for (const footprint of FOOTPRINTS) {
    if (footprint.covers(x, z)) return true;
  }
  return false;
}
