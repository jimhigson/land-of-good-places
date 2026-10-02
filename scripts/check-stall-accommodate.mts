/**
 * **Proves a stall will actually step aside, and that stepping aside costs
 * nothing.**
 *
 * Jim, 16 Sep 2026: *"maybe a stall would move, but this would be on the class
 * that does the stall placement to decide to move it to a position to
 * acoomodate a feature that needs the space more."* `world/stallsFeature.ts`
 * is that class. Measured over every seed in the pool and over 0..15, **no
 * seed refuses anything against a stall** — the layout keeps five metres of
 * walkable ground between plots, so nothing in the world phase ever needs a
 * booth's square metre. The capability was asked for regardless, and a
 * mechanism no seed exercises is a mechanism nobody would notice breaking.
 *
 * So this constructs the case instead: a real built park, the **real** stalls
 * builder the world phase just drove (`worldSolveStallBuilder()`), the real
 * registry and the real collision world — and a synthetic refused claim laid
 * across a booth's front wall, which is exactly what the driver hands
 * `accommodate` when a lamp or a trestle is refused by one.
 *
 * ## The control comes first
 *
 * CLAUDE.md is emphatic about this and it is why the reachability instrument
 * is exercised **before** it is trusted: "two agents got clean, decisive,
 * entirely wrong answers from flood fills that were measuring the wrong
 * thing, and only the control caught it." So the flood is asked two questions
 * whose answers are known before it is asked anything that matters — a point
 * a child certainly can reach, and a point she certainly cannot — and the run
 * is **VOID** rather than green if it gets either wrong.
 *
 * ## What it then asserts
 *
 * 1. **It moves.** A booth asked to clear a claim across its own counter
 *    returns an increment, not a refusal.
 * 2. **It really cleared the asker.** None of the booth's new claims overlaps
 *    the claim it was asked to clear.
 * 3. **Mesh, collider and claim moved together.** The prop's group is at the
 *    new spot; every new claim has a matching wall collider in the built
 *    world; the old walls are gone (the wall count is unchanged).
 * 4. **The counter still works.** The new stand point has room for a
 *    `PLAYER_RADIUS` body and is still reachable from the park entrance on a
 *    lattice rebuilt over the moved booth.
 * 5. **The refusal path leaves nothing half-moved.** Asked to clear something
 *    it cannot clear, the booth refuses *and* is exactly where it was —
 *    position, claims and colliders — which is the failure mode that would
 *    otherwise ship a booth whose collider is a metre from its mesh.
 *
 * Run: `pnpm run check:stall-accommodate` (`LGP_SEED=n` for any seed).
 */
import './headless-canvas.mjs';
import { buildHeadlessPark } from './park-harness.mts';
import { ACCEPTANCE_SCOPE, VOID_EXIT } from './lib/checkScope.mts';
import { stallAccommodate } from './lib/stallAccommodate.mts';

// The check is `lib/stallAccommodate.mts`'s, one owner with the acceptance loop.
const seed = process.env['LGP_SEED'] ?? 'canonical';
const result = await stallAccommodate(() => buildHeadlessPark());
if (result.voids.length > 0) process.exit(ACCEPTANCE_SCOPE ? VOID_EXIT : 2);
// Under the acceptance scope (`lib/checkScope.mts`) only decision clauses fail;
// in CI every clause does.
const failures = [...result.decisions, ...(ACCEPTANCE_SCOPE ? [] : result.code)];
console.log(
  failures.length === 0
    ? `\ncheck:stall-accommodate seed ${seed}: PASS`
    : `\ncheck:stall-accommodate seed ${seed}: ${failures.length} FAILURE(S)`,
);
process.exit(failures.length === 0 ? 0 : 1);
