# HANDOFF — E6-ramp, issue #198 (Sky Cruiser flies through foliage)

**Branch `feat/cruiser-ramp-clearance`, worktree `.claude/worktrees/cruiser-ramp`,
port 5326 if a dev server is ever needed.** Rebased onto `origin/main` (b0cfcd5)
on 5 Aug — see "Rebase" below, it matters.

## State

Root cause established and **the issue's own suggested fix is wrong** (see next
section). Implementation of the real fix in progress.

## The finding that changes the fix

Issue #198 says: extend `stationWindowIsClear` along the real ramp and let the
solver reject those start poses. **That cannot work, for two independent
reasons, and both are facts about the code rather than opinions.**

1. **The route is solved before any tree exists.** `COASTER_PLANS` is a
   module-load constant (`coaster/plan.ts:104` calls `new CoasterRoute(...)` at
   top level), and `World.ts:17` imports it — so the loop is fully solved before
   `new World()` runs. The trees and bushes are scattered later, inside the
   constructor at `World.ts:77`. At the moment `stationWindowIsClear` runs there
   is no foliage to avoid.
2. **Even with infinite reach it would still miss.** `groundClearOfPlots`
   iterates `PARK_LAYOUT.entries`, which holds **12 plots and no foliage at
   all** (`parkManifest.ts:103`). The bush struck on the canonical seed is 3.5 m
   from the platform — already *inside* the old ±6 m window. Reach was never the
   whole bug.

So the dependency has to point the other way: **`Scenery` gives way to the Sky
Cruiser**, exactly as it already gives way to the train. That precedent is
already written down in this very file, at `Scenery.ts:685-690`:

> The dependency used to point the other way — the route was solved against the
> finished collision world and bent around trees — but the route is a pure
> pre-scene plan now (`train/plan.ts`), so the trees are the ones that give way.

The Sky Cruiser is a pure pre-scene plan in exactly the same sense.

## What is actually struck, measured on all five CI seeds

| seed | strikes | what |
| --- | --- | --- |
| 20260728 | 2 | tree-canopies, bushes |
| 2 | 3 | bushes, tree-canopies, tree-trunks |
| 5 | 4 | **wooden wall run**, bushes, tree-cones, tree-canopies |
| 11 | 2 | bushes, tree-cones |
| 18 | 1 | bushes |

**Every seed strikes something**, and it is not only foliage: seed 5 flies
through a `scenery / wooden-walls` run (it reports as `'Mesh'` because the wall
meshes are unnamed — worth fixing in the complaint text). All of it is
`Scenery`, all of it in the station region, which is why one fix covers it.

## Two numbers that kill the "cruise floor clears the trees" premise

Measured, canonical seed:

- **`tree-canopies` reach 6.68 m** above their own terrain. The cruise floor is
  6.2 m and the car's underside is 6.04 m. A tall tree under the cruise line is
  a strike waiting for a seed to place one — it just has not happened yet on
  these five.
- **83 m of the 185 m loop has the car's underside below 6 m** — the station
  carve *and* the castle window carve with its ramps. The low stretch is not a
  station detail.

This is why the fix must be **height-aware** rather than a flat corridor: a flat
keep-out sized for the tallest possible tree would apply along most of the loop
and strip a wide swathe of lawn (the scatter is already budget-limited, 26-30
trees against an anti-vacuity floor of 24). Short plants must still be allowed
to live under the high parts of the loop.

## Design being implemented

A `clearOfCruiser(x, z, reach, topY)` in `Scenery.ts`, mirroring the existing
`clearOfWalls(x, z, reach)` — a separate explicit call at each scatter site, not
folded into `isPlantable`:

- refuses a spot when any sample of the loop within `reach + CART_ENVELOPE.halfWidth`
  horizontally has the car's **underside below the plant's own top**;
- called in the tree loop after `kind`/`reach` are known (so **no RNG draw is
  reordered** — `pickTreeKind` already runs before `clearOfWalls`), in the bush
  loop, and inside `runIsClear` for wall runs.

Thresholds come from the game (`CART_ENVELOPE` in `coaster/cart.ts`), never from
the generator's `CORRIDOR_RADIUS`.

**Expect the tree count to drop and the attempt budget to need raising** — there
is direct precedent at `Scenery.ts:330-342`, where adding the wall refusal took
the canonical seed from 30 trees to 19 until the budget went up.

## Rebase — read this before merging anything in this lineage

PR #196 merged to `main` **squashed**, so `git merge-base --is-ancestor` gives no
warning and a stale `test/procgen/parkFacts.ts` would silently revert part of
#114. This branch has been rebased with
`git rebase --onto origin/main e3de651`, which drops the two
`chore/invariant-return-complaints` commits whose content is already in main.

Proof it is clean: `git diff origin/main...HEAD -- test/procgen/parkFacts.ts` is
purely additive (the castle `castlePass` block), and `everyDestinationIsANode`
still exists in `invariants.ts`.

`main` already has `type Invariant = (facts: ParkFacts) => readonly string[]`;
write new invariants in the return form.

## Still to do

1. Implement `clearOfCruiser`, measure tree counts on all five seeds, raise the
   scatter budget if needed.
2. Name the wall meshes (or name strikes by nearest named ancestor) so a
   complaint says `wooden-walls`, not `Mesh`.
3. Wire `measure:cruiser-clearance` in as a real check + a procgen invariant.
   **Only once it passes** — it is deliberately unwired today.
4. **Then** retire `TOO_TALL_TO_FLY_OVER` (`invariants.ts`, now `['ferrisWheel']`)
   and its false "the cruise floor clears the trees" comment, plus the same list
   in `route.ts` (`tallObstacles`, the boot assert).
5. Prove the new invariant red before trusting it, on all five seeds.

## Queued behind this (from the Overseer)

- **Castle crossing must always happen.** Jim's direction: weight the
  generator's decisions toward it via a *general, named influence* mechanism any
  ride can declare (not a castle special case), plus a validity backstop that
  re-solves a route that still misses. Must be opt-in and **absent-by-default
  byte-identical** — `generate.ts` is shared with the ginormous slide, which
  another engineer is mid-flight on. Record in `ARCHITECTURE-DECISIONS.md`.
- **#197** — typecheck `scripts/`. Try `@types/node` with `"types": []` first:
  module declarations resolve while globals stay out. #192 rejected
  `"types": ["node"]`, which is a different thing.
