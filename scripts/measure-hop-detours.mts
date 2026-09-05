/**
 * **What does it actually cost to walk round a hoppable wall?**
 *
 * **This answers half of `NavGrid`'s `HOP_COST_MULTIPLIER`, and it is the half
 * that does not bind.** It asks only "how dear must a crossing be before a wall
 * is walked round?", which sets a *floor*; it cannot see the opposite failure —
 * a child sent round the houses to reach a spot four metres off the kerb — and
 * the multiplier derived from it alone (6.4, the p90 of the detours below) was
 * 183.9% over that ceiling. `scripts/sweep-hop-multiplier.mts` is what puts
 * both questions to the constant at once, and it is what 2.65 came from.
 *
 * It is a measurement of the built park, not a round number: for every hoppable
 * collider the auto-hop really clears, it stands two points either side of the
 * wall and asks what a walker **who cannot jump at all** must do to get from
 * one to the other. That walker is a lattice built with `hopApex = 0`, which
 * makes `autoHopClears` false for everything and so stamps every hoppable
 * collider solid — no second code path and no flag, the same `NavGrid` told
 * she has no jump.
 *
 * How much longer that is than the straight line through the wall is the real
 * detour: the price a child pays for going round *that* wall.
 *
 * **Measured against the straight line, not against a second routed crossing.**
 * The multiplier this feeds is precisely what makes a crossing dearer, so
 * measuring the crossing with the router would make the derivation circular and
 * the number would drift every time it was re-run. The straight line between
 * two points either side of one wall *is* the crossing.
 *
 * The `now` column is the separate question of what the router plans **today**,
 * penalty and all — the before/after, not the input to the derivation.
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
import { CI_SWEEP_SEEDS } from '../src/world/parkSeedPool.ts';

/**
 * The five seeds CI builds a park on — the canonical one and four sweeps.
 *
 * **Seed 24, not seed 2.** `test/procgen/` is the owner of this list, and #429
 * retired seed 2 from it: seed 2 proves zero bridge sites, so it is
 * pathological rather than merely different, and `test/procgen/seed-24.test.ts`
 * records why 24 replaced it. This file was still sweeping the retired seed,
 * which is not a cosmetic drift — seed 24 is the seed that binds the fountain
 * hardest, so the check that exists to defend the fountain was the one seed
 * short of being able to see it.
 */
const CI_SEEDS = CI_SWEEP_SEEDS; // the pool's own sweep list — see parkSeedPool.ts

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

/**
 * The sampler the *game* routes on — `World.attachPlayer` wraps the building's
 * surfaces with the fountain's wading dip, and the fountain rim is one of the
 * hoppable walls measured here, so the harness's bare sampler would be
 * measuring a park the player never walks in.
 */
const sample = (x: number, z: number, y: number): number =>
  park.world.fountain.groundLevel(x, z, park.sample(x, z, y));

/** The lattice the game plans on. */
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
  const ay = sample(ax, az, 0);
  const by = sample(bx, bz, 0);
  const count = grid.findRoute(ax, az, ay, bx, bz, by, sample, out);
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
  /** Straight through: the distance between the two probe points. */
  straight: number;
  /** The best a walker with no jump can do — round the end of the wall. */
  round: number;
  /** What going round costs over walking straight through. */
  detour: number;
  /** What the router plans **today**, hop penalty and all. */
  now: number;
}

const samples: Sample[] = [];
/** Crossings with no way round at all — the fountain rim is 28 of them. */
let onlyWayOver = 0;
/** Probes neither lattice could route, so they say nothing either way. */
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

  const now = routeLength(hopping, ax, az, bx, bz);
  const round = routeLength(grounded, ax, az, bx, bz);
  if (now === null) {
    unroutable += 1;
    return;
  }
  if (round === null) {
    // Nothing to compare: over the wall is the only way there is. That is not
    // a failed probe, it is the fountain — and it is the case Jim's ruling
    // named, so it is counted rather than swallowed.
    onlyWayOver += 1;
    return;
  }
  // Measured against the straight line rather than against a second routed
  // crossing, deliberately: the multiplier this feeds is what makes the
  // crossing dearer, so a crossing route would make the derivation circular
  // and the number would move every time it was re-run. The straight line
  // between two points either side of one wall is the crossing, exactly.
  const straight = 2 * reach;
  samples.push({ what, band, straight, round, detour: round - straight, now });
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
console.log(
  `${samples.length} hoppable crossings measured, ${onlyWayOver} with no way round at all, ` +
    `${unroutable} unroutable\n`,
);
console.log('band  straight   round  detour     now  goes  what');
let goesRound = 0;
for (const s of samples.sort((a, b) => a.detour - b.detour)) {
  // The router "went round" if what it plans today is nearer the way round
  // than to the straight line through the wall.
  const round = s.now - s.straight > s.round - s.now;
  if (round) goesRound += 1;
  console.log(
    `${s.band.toFixed(2)}  ${s.straight.toFixed(2).padStart(8)}  ${s.round.toFixed(2).padStart(6)}  ` +
      `${s.detour.toFixed(2).padStart(6)}  ${s.now.toFixed(2).padStart(6)}  ` +
      `${round ? 'round' : 'over '}  ${s.what}`,
  );
}
console.log(
  `\nthe router walks round ${goesRound} of these ${samples.length} and crosses ` +
    `${samples.length - goesRound}`,
);
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
