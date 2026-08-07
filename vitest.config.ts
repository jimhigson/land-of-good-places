import { defineConfig } from 'vitest/config';

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
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
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
