/**
 * **Stepping off the kerb: how far round does the router send her?**
 *
 * Prints one `KERB` line per probe, so a driver can compare two builds of the
 * router without either of them knowing the other exists.
 *
 * The probe is the case Jim named when he asked for path weighting — *"a comic
 * detour to reach something two metres away across grass"* — and it is the one
 * `feat/prefer-walking-on-paths` caught #452's hop penalty with: a destination
 * 2–6 m off the paving, started from the nearest point on the path network's
 * own centreline. That is the geometry of tapping the bench you are standing
 * next to.
 *
 * ```
 * LGP_SEED=n node --no-warnings --import ./scripts/ts-extension-resolver-register.mjs \
 *      scripts/measure-kerb-detour.mts
 * ```
 */
import './headless-canvas.mjs';
import { buildHeadlessPark } from './park-harness.mts';
import { MAX_ROUTE_WAYPOINTS, NavGrid } from '../src/world/NavGrid.ts';
import { distanceToPath, pathCentreline } from '../src/world/pathGraph.ts';
import { GARDEN_PLAY_RADIUS, PLAYER_RADIUS } from '../src/core/constants.ts';
import { JUMP_APEX_HEIGHT } from '../src/entities/Player.ts';
import { PARK_SEED } from '../src/world/parkManifest.ts';

/** How far off the kerb "just across the grass" means. */
const HOP_MIN = 2;
const HOP_MAX = 6;

const park = buildHeadlessPark();
const { collision } = park.world;

/** The sampler the game routes on — the fountain's wading dip included. */
const sample = (x: number, z: number, y: number): number =>
  park.world.fountain.groundLevel(x, z, park.sample(x, z, y));

const grid = new NavGrid(collision, PLAYER_RADIUS, JUMP_APEX_HEIGHT);
const out = new Float32Array(MAX_ROUTE_WAYPOINTS * 2);

const centreline = pathCentreline();
let seen = 0;
let emitted = 0;
for (let x = -GARDEN_PLAY_RADIUS; x <= GARDEN_PLAY_RADIUS; x += 3) {
  for (let z = -GARDEN_PLAY_RADIUS; z <= GARDEN_PLAY_RADIUS; z += 3) {
    if (Math.hypot(x, z) > GARDEN_PLAY_RADIUS - 4) continue;
    const off = distanceToPath(x, z);
    if (off < HOP_MIN || off > HOP_MAX) continue;
    seen += 1;
    if (seen % 3 !== 0) continue;

    let bestX = 0;
    let bestZ = 0;
    let best = Infinity;
    for (const s of centreline) {
      const d = Math.hypot(s.x - x, s.z - z);
      if (d < best) {
        best = d;
        bestX = s.x;
        bestZ = s.z;
      }
    }

    const ay = sample(bestX, bestZ, 500);
    const by = sample(x, z, 500);
    const count = grid.findRoute(bestX, bestZ, ay, x, z, by, sample, out);
    let length = 0;
    let px = bestX;
    let pz = bestZ;
    for (let i = 0; i < count; i += 1) {
      const wx = out[i * 2] ?? 0;
      const wz = out[i * 2 + 1] ?? 0;
      length += Math.hypot(wx - px, wz - pz);
      px = wx;
      pz = wz;
    }
    // seed, x, z, offset, route length, reached
    console.log(
      `KERB ${PARK_SEED} ${x} ${z} ${off.toFixed(2)} ${length.toFixed(4)} ` +
        `${grid.lastRouteReachedGoal ? 1 : 0}`,
    );
    emitted += 1;
  }
}

if (emitted < 8) {
  console.error(
    `measure-kerb-detour: only ${emitted} points sit ${HOP_MIN}–${HOP_MAX} m off the paving ` +
      'on this seed. That is not a park with grass in it.',
  );
  process.exit(1);
}
