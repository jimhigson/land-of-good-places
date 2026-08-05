# HANDOFF — E6-ramp, issue #198 (Sky Cruiser flies through foliage)

**Branch `feat/cruiser-ramp-clearance`, worktree `.claude/worktrees/cruiser-ramp`,
port 5326 if a dev server is ever needed.** Rebased onto `origin/main` (b0cfcd5)
on 5 Aug — see "Rebase" below, it matters.

## State

**DONE and green.** `npm run build` exit 0, `npm run test:procgen` 122 passed.
Rebased onto `origin/main` 6e7ae78. No PR raised (waiting on the Overseer).

Five commits, `09500c3..4ebc963`. Strikes go **2/3/4/2/1 -> 0/0/0/0/0** across
the five CI seeds.

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

## What landed

1. `clearOfCruiser` in `Scenery.ts` — height-aware keep-out, called by the tree
   scatter (after the kind is picked, so **no RNG draw moves**), the bush
   scatter, and `runIsClear` for wall runs.
2. Strikes are named by nearest named ancestor, so seed 5's unnamed wall reads
   `wooden-walls / Mesh` rather than `Mesh`.
3. `measure:cruiser-clearance` -> `check:cruiser-clearance`, wired into `build`.
4. `TOO_TALL_TO_FLY_OVER` retired from `invariants.ts`, replaced by the swept
   measurement. The false "cruise floor clears the trees" claim is corrected in
   all three places it was stated.
5. New invariant `the Sky Cruiser flies clear of the whole park`, **proven red**
   on all five seeds against the pre-fix scatter, with real coordinates in the
   messages (no NaN/Infinity). Test count 117 -> 122, the +5 confirming no seed
   silently skips it.

### The one thing a reviewer should push on

**The tree budget is pinned between two failures with one tree of headroom.**
Below 180 000 the anti-vacuity tree floor goes red on seed 5; at 210 000
`check:park` goes red because the extra colliders wall in a waypoint at
(-13.8, 15.6). Isolated properly rather than guessed — trees and walls use
separate RNG streams, so disabling the wall keep-out left the stranding while
reverting the budget alone cleared it.

Two of the three trees seed 5 lost are **not** this branch's: the castle pass
moves the cruiser's exit, `paths.ts` routes to that exit, and #196 lengthened
every stall spur. Recovering those at source gives the headroom back.

### Retired from the invariant, kept in the solver — deliberately

`tallObstacles()` in `route.ts` survives, because it is an **input** to the
plan-view search, which must be told where not to go before there is a route to
measure. Replacing it with a measurement taken afterwards would let the loop
grow through the big wheel and then complain about it. Its comment now says so.

## PR #203 (the castle) — its CI red is fixed by this branch

#203 fails `seed-5 > built the park it was asked for` at exactly 24 trees.
Measured: `main` plants 26 on seed 5, #203 plants 24, this branch plants 25.
So it is #203's regression and this branch already carries the remedy. Either
merge #203 first and let this follow, or lift the budget bump into #203.

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
