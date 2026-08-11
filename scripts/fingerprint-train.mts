/**
 * Prints a fingerprint of the solved train plan, so a change to the solver can
 * be proved not to have moved it — the train's counterpart of
 * `fingerprint-cruiser.mts` / `fingerprint-slide.mts`.
 *
 * One seed per process (`LGP_SEED`), because the plan solves at module load:
 *
 *   for seed in 20260728 2 5 11 18
 *     env LGP_SEED=$seed node --no-warnings \
 *       --import ./scripts/ts-extension-resolver-register.mjs scripts/fingerprint-train.mts
 *   end
 *
 * Everything is serialised at **full double precision** (`String(x)` is exact
 * round-trip for a float64, where `toFixed(6)` would forgive a millionth), so
 * two runs agree on this hash if and only if every number in the plan is
 * bit-identical:
 *
 * - the route: control points, arc length, minClearance, and 2000 dense
 *   samples of the finished curve;
 * - both stations, every field;
 * - every level crossing, every field (via `computeCrossings`, called exactly
 *   as `ParkTrain` calls it);
 * - the fence's open spans are a pure function of the crossings, the station
 *   distances and the loop length (`fence.ts`, `buildRailFence` step 1), all
 *   of which are already in the hash — so fence identity rides on it too.
 */
import { createHash } from 'node:crypto';
import { Vector3 } from 'three';
import { TRAIN_PLAN } from '../src/world/train/plan';
import { computeCrossings } from '../src/world/train/crossings';
import { PARK_SEED } from '../src/world/parkManifest';

const route = TRAIN_PLAN.route;
const hash = createHash('sha256');
const put = (label: string, ...values: readonly (number | string)[]): void => {
  hash.update(`${label}:${values.map(String).join(',')};`);
};

put('length', route.length);
put('minClearance', route.minClearance);
for (const point of route.curve.points) put('control', point.x, point.y, point.z);
const p = new Vector3();
for (let i = 0; i < 2000; i += 1) {
  route.pointAt((i / 2000) * route.length, p);
  put('sample', p.x, p.y, p.z);
}
for (const s of TRAIN_PLAN.stations) {
  put('station', s.index, s.name, s.distance, s.standX, s.standZ, s.approachX, s.approachZ, s.leadX, s.leadZ);
}
const crossings = computeCrossings(
  route,
  TRAIN_PLAN.stations.map((station) => station.distance),
);
for (const c of crossings) {
  put('crossing', c.x, c.z, c.railDistance, c.pathDirX, c.pathDirZ, c.halfGap);
}

console.log(
  `seed ${PARK_SEED}  stations ${TRAIN_PLAN.stations.length}  crossings ${crossings.length}  ` +
    `length ${route.length.toFixed(4)}  TRAIN SHA256 ${hash.digest('hex')}`,
);
