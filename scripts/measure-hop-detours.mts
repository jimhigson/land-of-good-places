/**
 * **What does it actually cost to walk round a hoppable wall?**
 *
 * This is where `NavGrid`'s `HOP_COST_MULTIPLIER` comes from. It is a
 * measurement of the built park, not a round number: for every hoppable
 * collider the auto-hop really clears, it routes from one side of the wall to
 * the other twice —
 *
 * - once on the ordinary lattice, where a hoppable wall is not stamped at all,
 *   so the route goes **over** it; and
 * - once on a lattice built with `hopApex = 0`, which makes `autoHopClears`
 *   false for everything and so stamps every hoppable collider **solid**. No
 *   second code path, no flag: the same `NavGrid`, told the walker cannot jump.
 *
 * The difference between the two route lengths is the real detour — the price
 * a child pays for going round rather than over that particular wall.
 *
 * ```
 * node --no-warnings --import ./scripts/ts-extension-resolver-register.mjs \
 *      scripts/measure-hop-detours.mts [--sweep]
 * ```
 *
 * `LGP_SEED=n` measures another park. `--sweep` measures all five CI seeds —
 * each in its own child process, because the module caches pin a park to
 * whichever seed built it first — and pools the detours, which is the number
 * the multiplier is actually set from.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import './headless-canvas.mjs';
import { buildHeadlessPark } from './park-harness.mts';
import { MAX_ROUTE_WAYPOINTS, NavGrid } from '../src/world/NavGrid.ts';
import { autoHopClears } from '../src/world/Collision.ts';
import { PLAYER_RADIUS } from '../src/core/constants.ts';
import { JUMP_APEX_HEIGHT } from '../src/entities/Player.ts';
import { PARK_SEED } from '../src/world/parkManifest.ts';

/** The five seeds CI builds a park on — the canonical one and four sweeps. */
const CI_SEEDS = [PARK_SEED, 2, 5, 11, 18] as const;

/** The percentile of the pooled detours the price of a crossing is set to. */
const TARGET_PERCENTILE = 0.9;

function percentile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
}

if (process.argv.includes('--sweep')) {
  const self = fileURLToPath(import.meta.url);
  const pooled: number[] = [];
  const bands: number[] = [];
  for (const seed of CI_SEEDS) {
    const run = spawnSync(
      process.execPath,
      ['--no-warnings', '--import', './scripts/ts-extension-resolver-register.mjs', self],
      { env: { ...process.env, LGP_SEED: String(seed) }, encoding: 'utf8' },
    );
    const lines = (run.stdout ?? '').split('\n');
    let found = 0;
    for (const line of lines) {
      const detour = /^DETOUR ([\d.]+) ([\d.]+)$/.exec(line.trim());
      if (!detour) continue;
      pooled.push(Number(detour[1]));
      bands.push(Number(detour[2]));
      found += 1;
    }
    console.log(`seed ${String(seed).padStart(8)}: ${found} hoppable crossings`);
    if (found === 0) console.log((run.stdout ?? '') + (run.stderr ?? ''));
  }
  pooled.sort((a, b) => a - b);
  bands.sort((a, b) => a - b);
  const medianBand = percentile(bands, 0.5);
  console.log(`\n${pooled.length} crossings pooled over ${CI_SEEDS.length} seeds`);
  for (const q of [0, 0.25, 0.5, 0.75, 0.9, 0.95, 1]) {
    console.log(`  p${String(Math.round(q * 100)).padStart(3)}  ${percentile(pooled, Math.min(q, 0.999)).toFixed(2)} m`);
  }
  console.log(`median fattened band ${medianBand.toFixed(2)} m`);
  const target = percentile(pooled, TARGET_PERCENTILE);
  console.log(
    `\nto price a median crossing at the p${Math.round(TARGET_PERCENTILE * 100)} detour ` +
      `(${target.toFixed(2)} m): M = 1 + ${target.toFixed(2)}/${medianBand.toFixed(2)} = ` +
      `${(1 + target / medianBand).toFixed(2)}`,
  );
  console.log('\n  M   priced at   crossings that would go round');
  for (const M of [2, 4, 5, 6, 7, 8, 10, 12, 16, 20]) {
    const priced = (M - 1) * medianBand;
    const goRound = pooled.filter((d) => d < priced).length;
    console.log(
      `  ${String(M).padStart(2)}   +${priced.toFixed(1).padStart(5)} m   ` +
        `${goRound}/${pooled.length} (${((goRound / pooled.length) * 100).toFixed(0)}%)`,
    );
  }
  process.exit(0);
}

const park = buildHeadlessPark();
const { collision } = park.world;

/** The lattice the game plans on: hoppable walls simply are not there. */
const hopping = new NavGrid(collision, PLAYER_RADIUS, JUMP_APEX_HEIGHT);
/** The same lattice for a walker who cannot jump at all — every hop is solid. */
const grounded = new NavGrid(collision, PLAYER_RADIUS, 0);

const out = new Float32Array(MAX_ROUTE_WAYPOINTS * 2);

/** Route length in metres, or `null` if the router could not get there. */
function routeLength(
  grid: NavGrid,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): number | null {
  const ay = park.sample(ax, az, 0);
  const by = park.sample(bx, bz, 0);
  const count = grid.findRoute(ax, az, ay, bx, bz, by, park.sample, out);
  if (count === 0 || !grid.lastRouteReachedGoal) return null;
  let length = 0;
  let px = ax;
  let pz = az;
  for (let i = 0; i < count; i += 1) {
    const x = out[i * 2] ?? 0;
    const z = out[i * 2 + 1] ?? 0;
    length += Math.hypot(x - px, z - pz);
    px = x;
    pz = z;
  }
  return length;
}

interface Sample {
  what: string;
  band: number;
  over: number;
  round: number;
  detour: number;
}

const samples: Sample[] = [];
let unroutable = 0;

/** Probes one crossing: two points either side of `(x, z)` along `(nx, nz)`. */
function probe(
  what: string,
  x: number,
  z: number,
  nx: number,
  nz: number,
  band: number,
): void {
  // Far enough out that both ends stand clear of the wall's own fattened
  // footprint, plus a stride of elbow room.
  const reach = band / 2 + 1.5;
  const ax = x + nx * reach;
  const az = z + nz * reach;
  const bx = x - nx * reach;
  const bz = z - nz * reach;

  const over = routeLength(hopping, ax, az, bx, bz);
  const round = routeLength(grounded, ax, az, bx, bz);
  if (over === null || round === null) {
    unroutable += 1;
    return;
  }
  samples.push({ what, band, over, round, detour: round - over });
}

collision.forEachWall((x1, z1, x2, z2, halfThickness, topHeight, autoHoppable) => {
  if (!autoHoppable || !autoHopClears(topHeight, JUMP_APEX_HEIGHT)) return;
  const dx = x2 - x1;
  const dz = z2 - z1;
  const length = Math.hypot(dx, dz);
  if (length < 1e-6) return;
  // The wall's own normal, and its full fattened crossing.
  const nx = -dz / length;
  const nz = dx / length;
  const band = 2 * (halfThickness + PLAYER_RADIUS);
  probe(
    `wall ${length.toFixed(1)} m long, top ${topHeight.toFixed(2)} m`,
    (x1 + x2) / 2,
    (z1 + z2) / 2,
    nx,
    nz,
    band,
  );
});

collision.forEachCircle((x, z, radius, topHeight, autoHoppable) => {
  if (!autoHoppable || !autoHopClears(topHeight, JUMP_APEX_HEIGHT)) return;
  probe(
    `circle r${radius.toFixed(2)}, top ${topHeight.toFixed(2)} m`,
    x,
    z,
    1,
    0,
    2 * (radius + PLAYER_RADIUS),
  );
});

console.log(`seed ${PARK_SEED}`);
console.log(`${samples.length} hoppable crossings measured, ${unroutable} unroutable\n`);
console.log('band   over   round   detour  what');
for (const s of samples.sort((a, b) => a.detour - b.detour)) {
  console.log(
    `${s.band.toFixed(2)}  ${s.over.toFixed(2).padStart(6)}  ${s.round.toFixed(2).padStart(6)}  ` +
      `${s.detour.toFixed(2).padStart(6)}  ${s.what}`,
  );
}
// Machine-readable, for `--sweep` to pool across seeds.
for (const s of samples) console.log(`DETOUR ${s.detour.toFixed(4)} ${s.band.toFixed(4)}`);

if (samples.length > 0) {
  const detours = samples.map((s) => s.detour).sort((a, b) => a - b);
  const bands = samples.map((s) => s.band).sort((a, b) => a - b);
  const medianBand = percentile(bands, 0.5);
  console.log(
    `\ndetour  min ${percentile(detours, 0).toFixed(2)}  p25 ${percentile(detours, 0.25).toFixed(2)}  ` +
      `median ${percentile(detours, 0.5).toFixed(2)}  p75 ${percentile(detours, 0.75).toFixed(2)}  ` +
      `max ${percentile(detours, 0.999).toFixed(2)}`,
  );
  console.log(`median band ${medianBand.toFixed(2)} m`);
  console.log('Run with --sweep for the pooled figure the multiplier is set from.');
}
