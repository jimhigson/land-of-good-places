/**
 * Prints the seed a check script's park would be built from, and nothing else.
 *
 * Booted as a child process by `check:seed-pool`'s end-to-end clause, six times
 * over, to answer the question issue #496 turned out to be: **does a freshly
 * started check harness build the same park as the one before it?**
 *
 * The first line is the load-bearing one. Importing `headless-dom.mjs` is what
 * every check script in this directory does, and it is what installed the
 * `localStorage` shim that `resolveParkSeed` then drew a random park from. A
 * version of this file that skipped it would resolve the seed in a process the
 * fleet never runs and report a reassuring constant — the same fault as the
 * `delete globalThis.localStorage` that used to stand in `check-seed-pool.mts`.
 */
import './headless-dom.mjs';

const { PARK_SEED } = await import('../src/world/parkManifest.ts');

process.stdout.write(String(PARK_SEED));
