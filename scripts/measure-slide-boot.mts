/**
 * **How long does a child wait for the ginormous slide before they can play?**
 *
 * `SLIDE_PLAN` solves at module load, and `paths.ts` imports it, so the slide's
 * search sits directly in front of the first frame of the game. It is not a
 * background cost that can be hidden behind a loading screen — nothing else in
 * the park can be built until it answers.
 *
 * This measures that wait, per seed, on the module that the game itself
 * imports. Two things it deliberately does **not** do:
 *
 * - It does not time `solveRailRoute` in isolation. The number that matters is
 *   the one a six-year-old experiences, which includes every pass the length
 *   loop takes, not just the pass that succeeds.
 * - It does not build the park. Park construction is a few hundred
 *   milliseconds and is not what regressed; mixing it in would blur the signal.
 *
 * `LGP_SEED=n` for one seed, or no argument for the canonical seed plus the
 * four sweep seeds, which is what the PR body should quote.
 */
import { performance } from 'node:perf_hooks';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CI_SWEEP_SEEDS } from '../src/world/parkSeedPool.ts';

/** The pool's own sweep list — one owner, see parkSeedPool.ts (2 and 18 are out by ruling: neither can build a park since the level-tier deletion). */
const SWEEP_SEEDS = CI_SWEEP_SEEDS;

/**
 * Times one seed **in a fresh process**.
 *
 * A module solves once and caches, so a loop in a single process would time the
 * first seed honestly and every seed after it at zero. Re-importing with a
 * cache-busting query would work for the slide's own module but not for the
 * park layout underneath it, which also caches — so a whole process per seed is
 * the only measurement that cannot quietly report a cached answer.
 */
function timeSeedInChild(seed: number): { ms: number; length: number; ok: boolean; note: string } {
  const self = fileURLToPath(import.meta.url);
  const result = spawnSync(
    process.execPath,
    [
      '--no-warnings',
      '--import',
      './scripts/ts-extension-resolver-register.mjs',
      self,
      '--one',
    ],
    {
      env: { ...process.env, LGP_SEED: String(seed) },
      encoding: 'utf8',
      cwd: process.cwd(),
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  const line = (result.stdout ?? '').trim().split('\n').pop() ?? '';
  try {
    const parsed = JSON.parse(line) as { ms: number; length: number };
    return { ...parsed, ok: true, note: '' };
  } catch {
    const why = (result.stderr ?? '').trim().split('\n').slice(-3).join(' ').slice(0, 300);
    return { ms: Number.NaN, length: Number.NaN, ok: false, note: why || 'no output' };
  }
}

/** The child half: solve once, print one JSON line, say nothing else. */
async function measureOne(): Promise<void> {
  const started = performance.now();
  const { SLIDE_PLAN } = await import('../src/world/slide/plan.ts');
  const ms = performance.now() - started;
  process.stdout.write(`${JSON.stringify({ ms, length: SLIDE_PLAN.route.length })}\n`);
}

if (process.argv.includes('--one')) {
  await measureOne();
} else {
  const only = process.env.LGP_SEED;
  const seeds = only ? [Number(only)] : SWEEP_SEEDS;
  console.log('seed        solve      length   ');
  console.log('--------------------------------');
  let total = 0;
  let worst = 0;
  let failed = 0;
  for (const seed of seeds) {
    const { ms, length, ok, note } = timeSeedInChild(seed);
    if (!ok) {
      failed += 1;
      console.log(`${String(seed).padEnd(11)} FAILED — ${note}`);
      continue;
    }
    total += ms;
    worst = Math.max(worst, ms);
    console.log(
      `${String(seed).padEnd(11)} ${(ms / 1000).toFixed(2).padStart(6)} s ${length
        .toFixed(1)
        .padStart(8)} m`,
    );
  }
  console.log('--------------------------------');
  console.log(
    `worst ${(worst / 1000).toFixed(2)} s   total ${(total / 1000).toFixed(2)} s` +
      (failed > 0 ? `   ${failed} seed(s) failed to solve` : ''),
  );
  // The worst seed is what a child waits, so that is what this exits on.
  process.exitCode = failed > 0 ? 1 : 0;
}
