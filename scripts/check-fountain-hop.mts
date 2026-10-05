/**
 * **Can a child be sent into the fountain, and can she get out — and is she
 * left alone when she is only walking past?**
 *
 * ```
 * pnpm run sweep:fountain-hop
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
 * **CI asks it of every supported seed, inside `test/procgen`** — the
 * `aTapOnTheFountainWadesIn` invariant, on the park each seed file has already
 * built. It used to run here, over `CI_SWEEP_SEEDS`, building every park a
 * second time; at sixteen seeds that alone outgrew its check shard (killed at
 * 22 min on #706). The measurement is `src/world/fountainHop.ts`, one owner for
 * both. This script stays for running by hand. Every seed matters, and not
 * for thoroughness: it is the only reason mechanism 4 is checked at all. The terrain
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
import { measureFountainHop } from '../src/world/fountainHop.ts';
import { PARK_SEED } from '../src/world/parkManifest.ts';
import { CI_SWEEP_SEEDS } from '../src/world/parkSeedPool.ts';

/** Every supported seed, when run by hand without `LGP_SEED`. */
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
    console.error(`\nsweep:fountain-hop: the fountain is broken on seed(s) ${bad.join(', ')}`);
    process.exit(1);
  }
  console.log(`\nsweep:fountain-hop passed on all ${CI_SEEDS.length} seeds`);
  process.exit(0);
}

const park = buildHeadlessPark();
const clauses = measureFountainHop(park.world.fountain, park.world.collision, park.sample);
for (const { ok, what } of clauses) console.log(`${ok ? '  ok ' : 'FAIL '} ${what}`);
const failures = clauses.filter((c) => !c.ok).map((c) => c.what);

if (failures.length > 0) {
  console.error(`\nsweep:fountain-hop: ${failures.length} failure(s) on seed ${PARK_SEED}:\n`);
  for (const line of failures) console.error(`  ${line}`);
  process.exit(1);
}
console.log(`\nsweep:fountain-hop passed on seed ${PARK_SEED}`);
