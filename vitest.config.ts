import { globSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

import { PROCGEN_SHARDS, PROCGEN_SUITE_GLOB, shardMapProblems } from './test/procgenShards.ts';

/**
 * The procgen invariant suite.
 *
 * Its own config rather than `vite.config.ts`'s: the app config carries the
 * PWA plugin and a service-worker build, none of which a node-side geometry
 * check wants anywhere near it.
 *
 * `isolate` is load-bearing and must stay on. The seed reaches the generators
 * through `LGP_SEED`, which `parkManifest.ts` reads **once, at module load**,
 * so a seed is only really a seed if its test file gets a fresh module
 * registry. With isolation off, every seed file after the first would quietly
 * measure the first one's park. `parkFacts.ts` asserts the seed it got back to
 * catch that if it ever regresses, but the fix is here.
 */
/**
 * `LGP_PROCGEN_SHARD=N` runs only shard N of `test/procgenShards.ts` — the
 * CI matrix sets it. Refuses to run any shard while the map is not a partition
 * of the suite, so a new test file nobody placed fails CI rather than never
 * running in it.
 */
function procgenInclude(): string[] {
  const raw = process.env['LGP_PROCGEN_SHARD'];
  if (raw === undefined || raw === '') return [PROCGEN_SUITE_GLOB];
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > PROCGEN_SHARDS.length) {
    throw new Error(`LGP_PROCGEN_SHARD=${raw}: expected a shard number 1..${PROCGEN_SHARDS.length} (test/procgenShards.ts)`);
  }
  const problems = shardMapProblems(globSync(PROCGEN_SUITE_GLOB).map((f) => f.split('\\').join('/')));
  if (problems.length > 0) throw new Error(`test/procgenShards.ts is not a partition of the suite:\n${problems.join('\n')}`);
  return [...PROCGEN_SHARDS[n - 1]!];
}

export default defineConfig({
  test: {
    include: procgenInclude(),
    // Before any test file's imports: see src/core/deterministicMath.ts.
    setupFiles: ['test/setupDeterministicMath.ts'],
    pool: 'forks',
    isolate: true,
    // 240 s: seed 11's park is the slow one — its slide legitimately burns a
    // deep search budget threading between the castle, the pit and a low
    // cruiser loop (~160 s wall). Decision 6 prefers a slow solve to a park
    // that will not start, and the staged-procgen work (loading screen) will
    // move these solves off the critical path; until then the hook budget
    // simply has to fit the honest cost.
    testTimeout: 240_000,
    hookTimeout: 240_000,
  },
});
