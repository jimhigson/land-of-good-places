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
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
