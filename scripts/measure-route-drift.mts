/**
 * **A fingerprint of every route in the park, so a change to the router can be
 * shown not to have moved them.**
 *
 * `NavGrid` plans every walk in the game, so a change to how it prices a cell
 * is a change to *all* of them at once, and "it looks fine" is not a claim
 * anybody can check. This plans a fixed, deterministic sample of routes on the
 * built park and prints one line per route. Run it on two checkouts and diff:
 * every line that differs is a route that moved, and every one that does not is
 * a route proved untouched.
 *
 * ```
 * node --no-warnings --import ./scripts/ts-extension-resolver-register.mjs \
 *      scripts/measure-route-drift.mts > after.txt
 * ```
 *
 * `LGP_SEED=n` fingerprints another park. The pairs come from a seeded LCG
 * rather than from the park's own furniture, so the *same* pairs are asked for
 * on both sides of a comparison even if a change moves a bench.
 */
import './headless-canvas.mjs';
import { buildHeadlessPark } from './park-harness.mts';
import { MAX_ROUTE_WAYPOINTS, NavGrid } from '../src/world/NavGrid.ts';
import { PLAYER_RADIUS } from '../src/core/constants.ts';
import { JUMP_APEX_HEIGHT } from '../src/entities/Player.ts';
import { PARK_SEED } from '../src/world/parkManifest.ts';

/** Routes planned. Enough to cover the park densely; a couple of seconds. */
const ROUTES = 400;

const park = buildHeadlessPark();
/** The sampler the game routes on — see `World.attachPlayer`. */
const sample = (x: number, z: number, y: number): number =>
  park.world.fountain.groundLevel(x, z, park.sample(x, z, y));

const grid = new NavGrid(park.world.collision, PLAYER_RADIUS, JUMP_APEX_HEIGHT);
const out = new Float32Array(MAX_ROUTE_WAYPOINTS * 2);

const { minX, maxX, minZ, maxZ } = park.world.collision.playBounds.extent;

/** A small LCG, so the sample is identical on both sides of a comparison. */
let state = 0x2545f491;
const next = (): number => {
  state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
  return state / 0x100000000;
};
const spread = (lo: number, hi: number): number => lo + next() * (hi - lo);

const bounds = park.world.collision.playBounds;
/**
 * A point a walker could stand at, well inside the park. The bounding box is
 * much bigger than the park's spline, so a bare uniform sample spends most of
 * its draws outside it; rejecting those is what makes the fingerprint dense
 * enough to be worth diffing.
 */
const somewhere = (): { x: number; z: number } => {
  for (let tries = 0; tries < 200; tries += 1) {
    const x = spread(minX, maxX);
    const z = spread(minZ, maxZ);
    if (bounds.distanceToEdge(x, z) > PLAYER_RADIUS) return { x, z };
  }
  return { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2 };
};

console.log(`seed ${PARK_SEED}  ${ROUTES} routes`);
let planned = 0;
let reached = 0;
let totalLength = 0;
let totalWaypoints = 0;

for (let i = 0; i < ROUTES; i += 1) {
  const { x: ax, z: az } = somewhere();
  const { x: bx, z: bz } = somewhere();
  const count = grid.findRoute(
    ax,
    az,
    sample(ax, az, 500),
    bx,
    bz,
    sample(bx, bz, 500),
    sample,
    out,
  );
  let length = 0;
  let px = ax;
  let pz = az;
  for (let w = 0; w < count; w += 1) {
    length += Math.hypot((out[w * 2] ?? 0) - px, (out[w * 2 + 1] ?? 0) - pz);
    px = out[w * 2] ?? 0;
    pz = out[w * 2 + 1] ?? 0;
  }
  console.log(
    `${String(i).padStart(3)} ${ax.toFixed(1)},${az.toFixed(1)} -> ${bx.toFixed(1)},${bz.toFixed(1)}  ` +
      `wp ${String(count).padStart(3)}  len ${length.toFixed(2).padStart(7)}  ` +
      `${grid.lastRouteReachedGoal ? 'reached' : 'nearest'}`,
  );
  if (count > 0) planned += 1;
  if (grid.lastRouteReachedGoal) reached += 1;
  totalLength += length;
  totalWaypoints += count;
}

console.log(
  `\nplanned ${planned}/${ROUTES}  reached ${reached}  ` +
    `total length ${totalLength.toFixed(1)} m  total waypoints ${totalWaypoints}`,
);
