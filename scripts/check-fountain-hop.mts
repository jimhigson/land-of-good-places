/**
 * **Can a child be sent into the fountain, and can she get out — and is she
 * left alone when she is only walking past?**
 *
 * ```
 * npm run check:fountain-hop
 * ```
 *
 * Jim, 29 August 2026: *"make the fountain wall hoppable, but give hoppable
 * walls a high penalty so the route finding goes around them unless they are a
 * much better path — for example the destination is the water in the fountain
 * itself."*
 *
 * That one sentence rests on **four** separate mechanisms, three of them added
 * together, and every one of them fails *silently* — the router does not throw,
 * it just quietly walks her to the kerb and stops:
 *
 * 1. the rim segments are registered `autoHoppable` at all;
 * 2. `RIM_TOP_HEIGHT` is at or under `MAX_AUTO_HOP_HEIGHT`, or the flag is
 *    **inert** — `autoHopClears` says no, `NavGrid` goes on stamping the rim
 *    solid and `Player`'s lookahead never fires. Nothing complains:
 *    `checkHoppableColliders` only inspects colliders the predicate already
 *    calls hoppable, so a rim that is too tall slips past it too;
 * 3. `NavGrid` prices a hoppable band instead of blocking it; and
 * 4. inside a band the level rule is the hop's reach rather than a walking
 *    step — without which the wading surface, which stands **0.63–0.66 m above
 *    the plaza** against a 0.62 m `BUILDING_STEP_UP`, is out of reach.
 *
 * Four ways for a tap on the water to go dead, and no way to see any of them in
 * a diff. So they are checked here, on the real built park, by planning the
 * three routes a child actually asks for. Proven red by reverting each of the
 * four mechanisms in turn.
 *
 * **It runs on every seed `CI_SWEEP_SEEDS` holds — seven today, not the five
 * this line used to claim — and that is not thoroughness for its own sake, it
 * is the only reason mechanism 4 is checked at all.** The terrain
 * round the rim is not level, so whether *some* cell pair happens to clear a
 * walking step is down to the ground under that particular park. Measured with
 * mechanism 4 removed: the canonical seed and seeds 2, 5 and 18 still get in,
 * by luck, on whichever bearing the terrain runs highest — and **seed 11 does
 * not get in at all** (its rim step is 0.658 m over ground that varies by only
 * 5 mm all the way round). A single-seed check would have sat there green over
 * a mechanism it was written to guard.
 *
 * `check:park` owns whether the park *works*; this owns the one spot where
 * getting in is a jump rather than a walk.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import './headless-canvas.mjs';
import { buildHeadlessPark } from './park-harness.mts';
import { MAX_ROUTE_WAYPOINTS, NavGrid } from '../src/world/NavGrid.ts';
import { MAX_AUTO_HOP_HEIGHT, autoHopClears } from '../src/world/Collision.ts';
import { PLAYER_RADIUS } from '../src/core/constants.ts';
import { JUMP_APEX_HEIGHT } from '../src/entities/Player.ts';
import { PARK_SEED } from '../src/world/parkManifest.ts';
import { CI_SWEEP_SEEDS } from '../src/world/parkSeedPool.ts';

/**
 * The seeds CI builds a park on — whatever `CI_SWEEP_SEEDS` holds, which is
 * **seven** today.
 *
 * This comment used to say "the five seeds ... the canonical one and four
 * sweeps" and named seeds 2 and 18, one line above code that reads the pool
 * and contains neither. The code was right the whole time; the sentence over
 * it was a second copy of a fact with an owner, so it is now stated as a
 * reference rather than a number (#510).
 *
 * **The pool owns this list** (`CI_SWEEP_SEEDS`, 2 Sep 2026): this file's own
 * hand-typed copy kept building retired seed 18 after its retirement and
 * turned CI red on a seed the rules say does not have to pass.
 * Before that, seed 24 not seed 2: #429
 * retired seed 2 from it: seed 2 proves zero bridge sites, so it is
 * pathological rather than merely different, and `test/procgen/seed-24.test.ts`
 * records why 24 replaced it. This file was still sweeping the retired seed,
 * which is not a cosmetic drift — seed 24 is the seed that binds the fountain
 * hardest, so the check that exists to defend the fountain was the one seed
 * short of being able to see it.
 */
const CI_SEEDS = CI_SWEEP_SEEDS;

// Each seed needs its own module registry (the park is pinned to whichever
// seed built it first), so the sweep is child processes — the same reason
// `sweep-park-seeds.mts` spawns them. `LGP_SEED` in the environment means
// "you are the child, check this one park".
if (!process.env['LGP_SEED']) {
  const self = fileURLToPath(import.meta.url);
  const bad: number[] = [];
  for (const seed of CI_SEEDS) {
    const run = spawnSync(
      process.execPath,
      ['--no-warnings', '--import', './scripts/ts-extension-resolver-register.mjs', self],
      { env: { ...process.env, LGP_SEED: String(seed) }, encoding: 'utf8' },
    );
    const ok = run.status === 0;
    console.log(`--- seed ${seed}: ${ok ? 'passed' : 'FAILED'}`);
    if (!ok) {
      bad.push(seed);
      process.stdout.write(run.stdout ?? '');
      process.stderr.write(run.stderr ?? '');
    }
  }
  if (bad.length > 0) {
    console.error(`\ncheck:fountain-hop: the fountain is broken on seed(s) ${bad.join(', ')}`);
    process.exit(1);
  }
  console.log(`\ncheck:fountain-hop passed on all ${CI_SEEDS.length} seeds`);
  process.exit(0);
}

const failures: string[] = [];
const check = (ok: boolean, what: string): void => {
  console.log(`${ok ? '  ok ' : 'FAIL '} ${what}`);
  if (!ok) failures.push(what);
};

const park = buildHeadlessPark();
const fountain = park.world.fountain;
const { collision } = park.world;

/**
 * The sampler the game routes on. `World.attachPlayer` wraps the building's
 * surfaces with the fountain's own wading dip, and that dip is the whole
 * subject here, so the harness's bare sampler would be checking a park nobody
 * plays in.
 */
const sample = (x: number, z: number, y: number): number =>
  fountain.groundLevel(x, z, park.sample(x, z, y));

const navGrid = new NavGrid(collision, PLAYER_RADIUS, JUMP_APEX_HEIGHT);
const out = new Float32Array(MAX_ROUTE_WAYPOINTS * 2);

const centreX = fountain.centre.x;
const centreZ = fountain.centre.z;
/** Anything nearer the centre than this is in the water — `Fountain`'s own. */
const waterRadius = fountain.rimRadius - 0.3;

interface Route {
  reached: boolean;
  endY: number;
  /** How near the fountain's centre the walk ever passes. */
  closest: number;
}

function plan(ax: number, az: number, bx: number, bz: number): Route {
  const count = navGrid.findRoute(
    ax,
    az,
    sample(ax, az, 500),
    bx,
    bz,
    sample(bx, bz, 500),
    sample,
    out,
  );
  let closest = Math.hypot(ax - centreX, az - centreZ);
  let px = ax;
  let pz = az;
  for (let i = 0; i < count; i += 1) {
    const x = out[i * 2] ?? 0;
    const z = out[i * 2 + 1] ?? 0;
    // Sampled along each leg, not just at its ends: a straight line between
    // two points outside the rim can still pass straight through the water.
    const steps = Math.max(1, Math.ceil(Math.hypot(x - px, z - pz) / 0.25));
    for (let s = 0; s <= steps; s += 1) {
      const t = s / steps;
      closest = Math.min(closest, Math.hypot(px + (x - px) * t - centreX, pz + (z - pz) * t - centreZ));
    }
    px = x;
    pz = z;
  }
  return { reached: navGrid.lastRouteReachedGoal, endY: navGrid.lastRouteEndY, closest };
}

// ------------------------------------------------- 1. the flag is not inert

let rimSegments = 0;
let rimHoppable = 0;
let tallestRimTop = 0;
collision.forEachWall((x1, z1, x2, z2, _half, topHeight, autoHoppable) => {
  // The rim by its geometry rather than by a count typed in here: both ends of
  // a rim segment stand on the rim circle, at the fountain's own radius.
  const onRim = (x: number, z: number): boolean =>
    Math.abs(Math.hypot(x - centreX, z - centreZ) - fountain.rimRadius) < 0.05;
  if (!onRim(x1, z1) || !onRim(x2, z2)) return;
  rimSegments += 1;
  tallestRimTop = Math.max(tallestRimTop, topHeight);
  if (autoHoppable && autoHopClears(topHeight, JUMP_APEX_HEIGHT)) rimHoppable += 1;
});

check(rimSegments > 0, `the fountain rim is registered as walls (${rimSegments} segments)`);
check(
  rimHoppable === rimSegments,
  `every rim segment is hoppable, and the hop predicate agrees ` +
    `(${rimHoppable}/${rimSegments}; tallest top ${tallestRimTop.toFixed(2)} m against ` +
    `MAX_AUTO_HOP_HEIGHT ${MAX_AUTO_HOP_HEIGHT.toFixed(2)} m)`,
);

// ------------------------------------------- 2. a tap on the water gets there

/** Well clear of the rim on the plaza, and on the park's own paving. */
const outsideX = centreX;
const outsideZ = centreZ + fountain.rimRadius + 4;

const inbound = plan(outsideX, outsideZ, centreX, centreZ);
check(
  inbound.reached,
  `a tap on the water routes into it rather than stopping at the rim ` +
    `(reached=${inbound.reached})`,
);
const wading = sample(centreX, centreZ, 500);
check(
  Math.abs(inbound.endY - wading) < 0.01,
  `and the route ends on the wading surface, not on the paving outside ` +
    `(ends at ${inbound.endY.toFixed(3)} m, water ${wading.toFixed(3)} m)`,
);

// --------------------------------------------- 3. and she can get out again

const outbound = plan(centreX, centreZ, outsideX, outsideZ);
check(
  outbound.reached,
  `a child standing in the water can be routed back out of it — the basin is ` +
    `not a trap (reached=${outbound.reached})`,
);

// ----------------------------------- 4. but walking past is left well alone

// Straight across the plaza, the fountain squarely in the way. Going round it
// is a few metres; cutting through the water would be shorter, and the whole
// point of the penalty is that she does not.
const across = plan(centreX, centreZ + fountain.rimRadius + 4, centreX, centreZ - fountain.rimRadius - 4);
check(
  across.closest > waterRadius,
  `walking past the fountain keeps out of the water rather than paddling ` +
    `through it (closest approach ${across.closest.toFixed(2)} m, water edge ` +
    `${waterRadius.toFixed(2)} m)`,
);

if (failures.length > 0) {
  console.error(`\ncheck:fountain-hop: ${failures.length} failure(s) on seed ${PARK_SEED}:\n`);
  for (const line of failures) console.error(`  ${line}`);
  process.exit(1);
}
console.log(`\ncheck:fountain-hop passed on seed ${PARK_SEED}`);
