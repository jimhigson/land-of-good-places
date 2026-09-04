/**
 * **`CI_SWEEP_SEEDS` is exactly the pool seeds with a checked-in invariant
 * file** — the derivation `parkSeedPool.ts` claims, performed rather than
 * promised.
 *
 * Its doc comment said "the pool seeds with checked-in invariant files (the
 * deep sweep)" while seed 131 had `seed-131.test.ts` and was not in the list.
 * A comment written to retire a hand-maintained list was itself describing a
 * derivation nobody performed, and the `throw` beside it could not catch the
 * drift — it checks pool *membership*, which says nothing about which pool
 * seeds got left out.
 *
 * The list has to stay a literal: `parkSeedPool.ts` ships to the browser and
 * cannot read a directory. So the agreement is enforced from outside, here,
 * where a directory is readable — and it fails in **both** directions, because
 * either one is a real defect. A file without a list entry is a seed that
 * looks deeply swept and is not; a list entry without a file is a sweep step
 * that measures nothing.
 *
 * Cheap and seed-independent on purpose: this reads a directory listing and a
 * constant, builds no park, and so is not one of the slow per-seed files.
 * `parkSeedPool.ts` imports only `state/save`, so pulling it in here cannot
 * load `parkManifest.ts` before a seed is set (this suite's own trap — see
 * `invariants.ts`'s header).
 */
import { describe, it, expect } from 'vitest';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { CANONICAL_PARK_SEED, CI_SWEEP_SEEDS } from '../../src/world/parkSeedPool.ts';

/**
 * Every seed with a per-seed invariant file in this directory.
 *
 * `seed-canonical.test.ts` is the canonical seed under its name rather than
 * its number; `vet-seed-<n>.test.ts` files are the throwaways
 * `vet-seed-pool.mts` and `warp-search.mts` write for a seed with no
 * checked-in file, and are deliberately **not** counted — they are gitignored
 * scratch, and a killed run can leave one behind.
 */
function seedsWithInvariantFiles(): number[] {
  const here = dirname(fileURLToPath(import.meta.url));
  const seeds: number[] = [];
  for (const name of readdirSync(here)) {
    if (name === 'seed-canonical.test.ts') {
      seeds.push(CANONICAL_PARK_SEED);
      continue;
    }
    const match = /^seed-(\d+)\.test\.ts$/.exec(name);
    if (match) seeds.push(Number(match[1]));
  }
  return seeds.sort((a, b) => a - b);
}

describe('CI_SWEEP_SEEDS', () => {
  it('is exactly the pool seeds with a checked-in invariant file', () => {
    const fromFiles = seedsWithInvariantFiles();
    const listed = [...CI_SWEEP_SEEDS].sort((a, b) => a - b);

    // Announced on every run, passing or failing: a sweep list is the kind of
    // thing that is believed rather than read, and this is the one place that
    // knows how much it actually covers. `process.stderr`, not `console.log`,
    // because vitest's default reporter shows console output from *failing*
    // tests only — a note written the obvious way is invisible in exactly the
    // case it exists for (CLAUDE.md, "an announcement nobody can hear").
    process.stderr.write(
      `CI_SWEEP_SEEDS covers ${listed.length} of the pool's seeds, deep-swept: ` +
        `${listed.join(', ')}\n`,
    );

    // Both directions, and named separately so the failure says which defect
    // it is rather than printing two sorted lists and leaving it to the reader.
    const missingFromList = fromFiles.filter((seed) => !listed.includes(seed));
    const missingAFile = listed.filter((seed) => !fromFiles.includes(seed));

    expect(
      missingFromList,
      `these seeds have test/procgen/seed-<n>.test.ts but are not in CI_SWEEP_SEEDS, ` +
        `so they look deeply swept and are not — add them to parkSeedPool.ts`,
    ).toEqual([]);
    expect(
      missingAFile,
      `these seeds are in CI_SWEEP_SEEDS with no test/procgen/seed-<n>.test.ts, ` +
        `so that sweep step measures nothing — add the file or drop the seed`,
    ).toEqual([]);
  });
});
