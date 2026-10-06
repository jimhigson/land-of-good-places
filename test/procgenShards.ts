/**
 * **Which runner runs which file of the procgen invariant suite.** The one
 * owner: `vitest.config.ts` reads it for `LGP_PROCGEN_SHARD=N`,
 * `procgen-invariants.yml`'s matrix must list exactly `1..PROCGEN_SHARDS.length`,
 * and `check:seed-coverage` proves both by parsing — every `test/**\/*.test.ts`
 * in exactly one shard, every shard in the matrix.
 *
 * ## Why an explicit list and not `vitest --shard`
 *
 * `--shard=i/n` splits by file *count*, in an order nobody chooses. That was
 * fine while every heavy file cost about the same; it stopped being fine when
 * one file cost twenty minutes. On `main` at 7c8faaf0 shard 1 drew
 * `scatterDecoupling.test.ts` (five park builds back to back, 17-23 min on a
 * runner) and ran out of its 22m30s watchdog while shards 2-4 finished in two
 * minutes. So the files are placed by **measured** time.
 *
 * ## The measurements this placement is from (CI run 37291095907 and 37288828956)
 *
 * Wall time on a runner, each file alongside its shard-mates:
 *
 * - `store/wild-pets-catch` ~11 min (it builds a park at import);
 * - `scatterDecoupling-canonical` — one park build, baseline and bowed at
 *   once: ~5.5-8 min (was two of these back to back);
 * - `scatterDecoupling-seed12` — ~3.5-4.5 min, its control alongside;
 * - each `seed-N` 50-85 s of test time, about three at a time per runner;
 * - `railRaceRoadBounded`, `railRaceRefusals` ~15 s; the rest milliseconds.
 *
 * So each heavy file gets a shard with only two seeds beside it, and the
 * remaining seeds share three shards. **When a file gets slow, move it here
 * and say what you measured** — the shard job's log prints each file's time.
 */
export const PROCGEN_SHARDS: readonly (readonly string[])[] = [
  // 1 — the slowest file, ~11 min
  [
    'test/store/wild-pets-catch.test.ts',
    'test/procgen/seed-7.test.ts',
    'test/procgen/seed-1.test.ts',
    'test/attemptError.test.ts',
    'test/attemptStages.test.ts',
  ],
  // 2 — the canonical park, built twice at once
  [
    'test/procgen/scatterDecoupling-canonical.test.ts',
    'test/procgen/seed-13.test.ts',
    'test/procgen/seed-9.test.ts',
    'test/coplanar/sweepControls.test.ts',
    'test/coSolve.test.ts',
  ],
  // 3 — seed 12 built twice and the control park, at once
  [
    'test/procgen/scatterDecoupling-seed12.test.ts',
    'test/procgen/seed-10.test.ts',
    'test/procgen/seed-15.test.ts',
    'test/deterministicMath.test.ts',
    'test/geo/claimSurface.test.ts',
  ],
  // 4
  [
    'test/procgen/seed-14.test.ts',
    'test/procgen/seed-6.test.ts',
    'test/procgen/seed-2.test.ts',
    'test/railRaceRoadBounded.test.ts',
    'test/geo/core.test.ts',
    'test/geo/types.test.ts',
    'test/groundClaims.test.ts',
    'test/input/sub-frame-tap.test.ts',
  ],
  // 5
  [
    'test/procgen/seed-4.test.ts',
    'test/procgen/seed-11.test.ts',
    'test/procgen/seed-0.test.ts',
    'test/railRaceRefusals.test.ts',
    'test/input/text-entry-guard.test.ts',
    'test/input/wheel-zoom.test.ts',
    'test/parkChangingSwitches.test.ts',
    'test/parkSolveBounded.test.ts',
  ],
  // 6
  [
    'test/procgen/seed-12.test.ts',
    'test/procgen/seed-8.test.ts',
    'test/procgen/seed-5.test.ts',
    'test/procgen/seed-3.test.ts',
    'test/geo/boundaryDistance.test.ts',
    'test/procgen/acceptedPark.test.ts',
    'test/procgen/gridAxes.test.ts',
    'test/procgen/pavingLegibility.test.ts',
    'test/spookyJumpscare.test.ts',
    'test/store/live-look.test.ts',
    'test/store/overlay-pause.test.ts',
    'test/store/save-flags-round-trip.test.ts',
    'test/store/save-migration-ripika.test.ts',
  ],
];

/** The suite's files, as `vitest.config.ts`'s `include` matches them. */
export const PROCGEN_SUITE_GLOB = 'test/**/*.test.ts';

/**
 * Every way the shard map can disagree with the files on disk: a file in no
 * shard (it would never run in CI), in two (it would run twice), or a listed
 * file that does not exist. Empty when the map is a partition of `files`.
 */
export function shardMapProblems(files: readonly string[]): string[] {
  const problems: string[] = [];
  const owners = new Map<string, number[]>();
  PROCGEN_SHARDS.forEach((shard, i) => {
    for (const file of shard) owners.set(file, [...(owners.get(file) ?? []), i + 1]);
  });
  for (const file of files) {
    const at = owners.get(file) ?? [];
    if (at.length === 0) problems.push(`${file} is in no procgen shard, so CI never runs it — add it to test/procgenShards.ts`);
    if (at.length > 1) problems.push(`${file} is in procgen shards ${at.join(', ')} — each file belongs to exactly one`);
  }
  for (const file of owners.keys()) {
    if (!files.includes(file)) problems.push(`test/procgenShards.ts lists ${file}, which is not a test file`);
  }
  return problems;
}
