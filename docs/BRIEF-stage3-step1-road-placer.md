# Engineering brief — stage 3, step 1: the entrance road becomes the first production placer

**Status: IMPLEMENTED — PR #522, reviewed and approved 5 Sep.** Kept as the record of what was asked; two acceptance lines amended below to match what was accepted. No dependency on PR
#498 (`fix/road-487-488`, stalled) or on the ruling stage 3's later steps
wait for. Re-cut 5 Sep against `main` at `61e95fe5`; an earlier draft was
written against #498's `entrance/roadRoute.ts`, which does not exist on
`main` — if you find that file, #498 has landed, and the brief's intent
binds over its file references.

Authority: `docs/DESIGN-round-robin-generation.md`, "Stage 3, re-examined
(5 Sep)" — read it, and `src/boot/parkGeneration.ts`'s module header (the
import-ladder account) and the note at the top of `src/boot/coSolve.ts`
(which registry is live). One engineer, one worktree, normal CLAUDE.md
discipline throughout.

## The rule a reviewer looks for first

**The claim must BE the road — never a copy of it.** The corridor geometry
published to `GroundClaims` and the ribbon `Entrance.ts` builds must derive
from one owner: `entrance/layout.ts`'s line (`ENTRANCE_BUS_STOP_Z`, the
arrive/vanish `x` extents, whatever else it already owns) and `road.ts`'s
`ROAD_HALF_WIDTH`. If your diff contains a claim built by re-typing or
approximating what the builder uses, the PR is wrong even if every check
is green — that is the two-definitions disease this design exists to kill,
and "a comment promising the two agree is not a mechanism" (CLAUDE.md).
If the road has no single owner of its centreline today, making one IS in
scope; a claim then reads it, and so does the builder.

## What this step is

Three things, all invisible:

1. **The one production `GroundClaims` instance.** Today
   `src/boot/groundClaims.ts` is instantiated only by `test/groundClaims.test.ts`;
   `CoSolveEngine` (`coSolve.ts`) is test-only and still types against the
   superseded `PlacementField`. Create the registry in `parkGeneration.ts`
   (the scheduler is its owner), thread it to `World` the way the
   collision world is threaded — **one instance**, never a module-level
   singleton a second import could duplicate — and expose it to the check
   scripts / `parkFacts.ts` read-only, so the universal invariant can read
   claims off the built park.
2. **A `roadCorridor` scheduler task** that publishes one `corridor`
   claim for the road, derived from the owners above. There is no route
   search to move on `main` (the road is constants); the task exists so
   the road's ground is claimed *in the round-robin*, at a rung consistent
   with today's order. Do not confront the ladder (step 3).
3. **`CoSolveEngine` is NOT migrated here.** Leave it and `PlacementField`
   as they are; the engine moves onto `GroundClaims` when the first pair
   negotiates (step 4). Note it in the PR as deliberately untouched.

## What must not change

- **The park, at all.** Byte-identical on every pool seed — nothing in
  this step decides anything differently. Proved, not presumed.
- No trestle changes (step 2), no ladder loosening (step 3), no
  negotiation (step 4), no new constants, no `SECTION_LENGTH`-style knobs.
- Nothing from #498 cherry-picked. Its road shape is not on `main` and is
  waiting on a ruling; if it lands later the claim follows its owner.

## Acceptance — measured, not asserted

1. **Byte-identical proof**: a per-mesh digest of the whole built park
   (`scripts/park-digest.mts`, one process per seed), all pool seeds
   before and after, with two controls — determinism, and a perturbation
   the digest must see. Strictly contains the road and the legs. Do not build the park twice in one process
   (`paths.ts` mutates module-level paving — the buildGraph-twice trap).
2. **The claim is the road**: an assertion that the registry's corridor
   claim and the built road's centreline come from the same owner — by
   identity or byte-equality of the owner's output, not a tolerance
   comparison. **Break it deliberately** (perturb a copy) and paste the
   red run with the geometry it was proved against.
3. **The registry sees the road**: exactly **two** corridor claims (the
   road turns a corner at the gate; a capsule is straight), feature
   `road`, on every pool seed — a one-line probe in the same check.
4. **One instance**: a probe that `World`'s registry `===` the
   scheduler's. Break it (construct a second) and paste the red run.
5. Full gates: `pnpm run check`, `pnpm run test:procgen`,
   `pnpm run check:coplanar` — exit codes captured directly, never through
   `tail`/`head`. Verify the `check` chain by parsing `package.json`'s
   `scripts`, comparing step *sets* with `main`'s.

## Traps, pre-paid

- `test/procgen` static imports of seed-dependent modules pin every seed
  to the canonical park (76-silent-skips disease). Read facts from
  `ParkFacts`; `import type` is erased and safe. Watch the **pass** count.
- `rerere` is on: rebuild any `check`-chain conflict from `main`'s parsed
  step list, never accept the replay.
- This is invisible work. Per CLAUDE.md it merges after review + QA
  measurement without Jim, and there is nothing to screenshot — say so
  rather than manufacturing a preview link.

## Definition of done

One production registry, owned by the scheduler, reachable from `World`
and the checks; the road's corridor claimed by a task, derived from the
road's own owner; park byte-identical on all pool seeds with hashes quoted;
both deliberate breaks pasted red; all gates green; `CoSolveEngine`
untouched and said so.
