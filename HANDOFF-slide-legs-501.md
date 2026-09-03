# Issue #501 — the train drives through the ginormous slide's legs

Branch `fix/slide-legs-501`, worktree `.claude/worktrees/slide-legs-501`.
Engineer, **Opus 5 (1M context)** (`claude-opus-5[1m]`).

## Root cause (measured, not guessed)

`planSlideLegs` (`src/world/slide/supports.ts`) rejects a candidate against five
things: the castle footprint, the Sky Cruiser column, `collision.isClearCircle`,
`distanceToPath`, and the plot circles. **The railway is on none of them.**

It is not a case of "the collision world would have known": the rail corridor is
*not a collider*. The lineside fence is (`train/fence.ts` adds walls of
`TRACK_CLEARANCE` half-width) but `ParkTrain` is built in `World.ts` **after**
`Building`, so at leg-planning time there is nothing in `CollisionWorld` at all
where the railway will be.

**Ordering, established before designing anything:** `TRAIN_PLAN`
(`src/world/train/plan.ts`) is solved *at module load*, from the layout alone —
its own header says so, and `Scenery` already asks it the same question for
garden walls. `Building`'s constructor runs long after that. So the railway is
answerable where the legs are placed, and the fix belongs on the slide's side.

`World.ts`'s comment that the train "solves its loop against the finished
collision world" is **stale** — that inversion was undone when the plan became
pure. Corrected in this branch.

## The fix

`planSlideLegs` takes a third injected world query, `clearOfRailway(x, z)`,
alongside the `isClear` it already took. `Building.ts` supplies it as
`distanceToRailCorridor(x, z) >= RAIL_CORRIDOR_CLEARANCE` — both names read from
`train/plan.ts`, their single owner. **No new number is introduced.**

Backtracking is the existing `NUDGES` ladder (±10 m along the chute): a
candidate inside the corridor slides along the chute until it clears, and is
skipped only if nothing on that ladder does. No clearance is ever shrunk.

## Proof

`scripts/measure-slide-leg-rail.mts` — one line per seed, reporting the leg
count as well as the violations, so a "fix" that just stops building legs reads
as a worse park rather than as a clean run.

Before, all 16 pool seeds: **seed 5 only**, 4 legs inside the envelope, worst
face 0.43 m *past* the centre line — the same four coordinates the issue lists.
Every other seed clean.

After: see PR body / `scratchpad/m/after-*.txt`.

New invariant `slideLegsClearTheRailway` in `test/procgen/invariants.ts` — the
pairwise clause that never existed. Proved red on seed 5 before the fix.
