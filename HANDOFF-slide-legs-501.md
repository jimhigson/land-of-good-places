# Issue #501 — the train drives through the ginormous slide's legs

Branch `fix/slide-legs-501`, worktree `.claude/worktrees/slide-legs-501`.
Engineer, **Opus 5 (1M context)** (`claude-opus-5[1m]`) — the Engineer role's
default model, chosen by CLAUDE.md rather than per-task by Jim. A replacement
should resume on the same.

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

## Refuted: more attempts does not help (do not retry this)

The obvious backtrack — tighten the attempt cadence so more candidate
positions are asked — **was measured and does not work.** At the fence-honest
clearance, seed 5 tops out at **3 legs at every spacing tried**:

| `LEG_SPACING` | seed 5 legs | canonical legs |
|---|---|---|
| 6 (shipped) | 2 | 11 |
| 4 | 3 | 14 |
| 3 | 2 | 13 |
| 2 | 3 | 13 |

The canonical seed saturating at 13-14 is the useful half: the ground-space
crowding test, not the cadence, is what sets the real spacing, so more
attempts never produce a picket fence. It also never produces legs where
there is no ground. **The binding constraint on seed 5 is available ground.**

## Refuted: a greedy walk along the chute

Replacing the slot-and-nudge pass with a greedy walk (place wherever legal,
`LEG_SPACING` behind the last) was measured **worse**, not better: seed 5 gave
6 legs where the slot planner gives 8 with the railway ignored, and 3 where it
gives 4. Greedy-first takes the near edge of each clear stretch and then locks
out the 6 m behind it; the nudge ladder spreads better. Reverted.

## Instrument control (this one mattered)

The first clearance ladder re-ran `planSlideLegs` against the **finished**
collision world and reported 1 leg at clearance 0, where the park actually
builds 8. It was measuring a park that already contained the fence, the train,
the coaster and the legs themselves. The ladder is now driven through real park
builds, and the control — clearance 0 must reproduce the unfixed park exactly —
**passes**: 8 legs, the same four violations at the same four coordinates.

## Red proof, and the geometry it was proved against

**Commit `12a0fcaa`, base `4f32f8c8`, seed 5, chute 83.2 m.** Disabling *only*
the new rejection clause in `planSlideLegs` and running
`vitest run test/procgen/seed-5.test.ts -t railway`:

```
× no ginormous slide leg stands on the railway
AssertionError: a ginormous slide leg at -30.2, -15.6 stands 0.69 m from the rail centre line (needs 1.3 m) — the train drives through it
                a ginormous slide leg at -31.3, -18.1 stands 0.51 m ...
                a ginormous slide leg at -34.0, -21.9 stands 0.64 m ...
                a ginormous slide leg at -35.7, -27.3 stands -0.40 m ...
Tests  1 failed | 8 passed
```

Real numbers, no `NaN` and no `Infinity`, four legs at the four coordinates the
issue names. Clause restored: `9 passed`, exit 0.

## Pool result — per park

Railway violations: **0 on all 16 parks**, down from 4 on seed 5. The violation
*set* is empty, not merely a smaller count. Leg counts:

| seed | before | after | | seed | before | after |
|---|---|---|---|---|---|---|
| 20260728 | 11 | 11 | | 225 | 13 | 13 |
| **5** | **8 (4 illegal)** | **2** | | 267 | 8 | 8 |
| **11** | **7** | **6** | | 274 | 10 | 10 |
| 24 | 10 | 10 | | 288 | 12 | 12 |
| 115 | 8 | 8 | | 326 | 11 | 11 |
| 128 | 11 | 11 | | 346 | 7 | 7 |
| 131 | 12 | 12 | | 428 | 7 | 7 |
| 208 | 10 | 10 | | 451 | 8 | 8 |

Fourteen parks are untouched. Two pay legs, and one of them is a problem.

## OPEN — needs a decision, do not merge as-is

`pnpm run test:procgen` is **red on one clause**, and it is not the new one:

```
FAIL test/procgen/seed-5.test.ts > the ginormous slide stands on legs a child can walk between
AssertionError: the ginormous slide is 83 m long and stands on 2 legs — at least 4 were expected
Test Files 1 failed | 17 passed (18)   Tests 1 failed | 535 passed (536)
```

Seed 5's chute was only ever meeting that clause **by cheating** — four of its
eight legs stood in front of the train. Take those away honestly and the park
cannot stand its own slide up.

### Why, measured — it is not the railway's fault alone

Chute points forbidden by each rule, independently (seed 5, 91 samples):

| rule | seed 5 | canonical |
|---|---|---|
| paths (`PATH_CLEARANCE` 2.8) | **50 (55%)** | 22 (28%) |
| railway (this change) | 30 (33%) | 0 |
| too short to need a leg | 14 (15%) | 13 (16%) |
| castle | 6 | 2 |
| Sky Cruiser | 5 | 0 |
| **legal for a leg** | **5 (5%)** | **43 (54%)** |
| legal if the railway is ignored | 30 | 43 |

**Seed 5's chute has 5% supportable ground.** The dominant constraint is the
paved network, which this change did not touch; the railway is the second bite.
Crowding then reduces those 5 clustered points to 2 legs.

### Levers, and why the ones I did not pull are worse

1. **Shave the clearance to the train's 1.3 m envelope** — gives seed 5 four
   legs and a green suite. **Refused.** A foot centred at 1.82 m spans
   1.30-2.34 m and the fence occupies 1.82-2.18 m: it ships a post through the
   fence. This is fitting the number to the seed pool.
2. **Ask the real fence instead of a constant**, since the fence opens at
   stations and crossings. **Refuted by measurement.** All five chute points in
   the 1.82-2.70 m band that sit in an open stretch are within 5.9 m of a
   station — the fence is open there because a **platform** is there, reaching
   3.7 m from the centre line. Wider, not narrower.
3. **More attempts / tighter spacing / a greedy walk** — refuted above. Ceiling
   of 3 legs at every spacing; the constraint is ground, not attempts.
4. **Re-route the chute** so it spends less of its length over the loop and
   beside the paths. This is the standing rule's own last lever and probably the
   right long-term answer, but it is a change to `slide/solve.ts`'s 3.5 s search
   that moves the slide's shape on **every** park — a separate, visible ticket,
   not this one.
5. **Swap seed 5 out of the pool.** CLAUDE.md's own sanctioned move: *"Never
   weaken an assertion to make a seed pass — swap the seed and write down why."*
   Seed 5 no longer conforms to the invariants, and the pool is by definition
   the seeds that do. Costs a `pnpm run vet:seeds` run (about one candidate in
   thirty passes) and retiring `test/procgen/seed-5.test.ts`.

**My recommendation: (5) now, (4) as a follow-up ticket.** (5) is what the pool
is for and what the repo already says to do; (4) is the real fix for parks whose
chute is hemmed in, and it needs Jim's eyes because it changes what the slide
looks like everywhere.

**Not my call to make alone** — escalated to the Overseer.
