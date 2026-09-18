# HANDOFF — `check:waypoints` was comparing against `NaN..NaN`

- **Branch**: `fix/waypoints-nan`, based on `origin/feat/procgen-on-sphere` (`ae20b9fc`).
- **Worktree**: `.claude/worktrees/waypoints-nan`
- **Model**: Opus 5 (1M context). Chosen by the Overseer's Engineer default.
- **Role**: Engineer. PR targets `feat/procgen-on-sphere`, not `main`.

## Root cause (settled)

`scripts/check-waypoints.mts` reads `BUILDING_CENTRE_X/Z` from
`src/world/building/layout.ts` to build the facade rectangle it tests waypoints
against.

Commit **`196c17d0`** ("Every park decision is made by the backtracking driver;
the module constants are views of it", **16 Sep 2026**, on this branch only)
turned those from `const`s computed at import into:

```ts
export let BUILDING_CENTRE_X = Number.NaN;
export let BUILDING_CENTRE_Z = Number.NaN;
```

rebound by `bindCastlePlacement(layout)`, which `parkPlan.ts` calls from the
layout builder's `set()` — i.e. only once the park is actually solved.

**Nothing in `check-waypoints.mts`'s import graph solves the park.** Proved by
probe: after importing `poiGraph.ts`, `spaces.ts` and `layout.ts`,
`parkPlanSolved()` is `false` and `BUILDING_CENTRE_X` is `NaN`; calling
`solveParkPlanNow()` makes it `45.66`. So both bounds were `NaN` on every run.

The second-order effect is what produced 245 complaints. The clause was written
as a skip:

```ts
if (seed.x < west || seed.x > east || seed.z < north || seed.z > south) continue;
```

Every comparison against `NaN` is false, so the "this waypoint is *outside* the
facade, skip it" `continue` **never fired** and all 245 waypoints were pushed as
failures.

## The fix

1. `solveParkPlanNow()` at the top of the script body, before the bounds are read.
2. A finite guard on all four edges: a non-finite bound exits 1 with a message
   saying the check cannot run, rather than indicting the whole table.
3. The facade clause rewritten as a positive `inside` predicate.
4. The summary line prints the seed, the rectangle and the centre, 2 d.p.

## Answers to the two questions

1. **Where the NaN came from**: `BUILDING_CENTRE_X/Z`, unbound because the
   script never solved the park. Not the `RIDE_SCALE` temporal-dead-zone crash
   the sibling engineer is on — **different cause, no overlap**.
2. **Cover lost, and for how long**: 2 days, on this branch only. `origin/main`
   still has `export const BUILDING_CENTRE_X = …`, so `main`'s copy of this
   check is honest. And the check was **red, not falsely green** — it could not
   *pass*, rather than could not *fail* — so nothing got past it. What it could
   not do was *distinguish*: the facade clause gave zero cover for those two
   days. The second clause (every waypoint in the `garden` space) never touched
   a NaN and kept working throughout: 245/245 in `garden`.
   Note it is step **29** of the 67-step `check` chain, past the step-24 stop,
   so CI never reached it either.

## Proof

Green (seed 20260728), exit 0, every number real:

```
seed=20260728 waypoints=245 facade=(33.66,3.82)..(57.66,21.82) centre=(45.66,12.82)
every waypoint is somewhere a child could stand.
```

Controls: see the PR body — both pasted with their geometry.

## Status

- [x] Root cause found and proved
- [x] Fix committed and pushed
- [x] Control 1 (plant waypoints in the facade) — red with real numbers
- [x] Control 2 (remove the solve) — finite guard fires
- [x] Seed-pool sweep of `check:waypoints` — **all 10 pool seeds exit 0**, each
      with a different real rectangle (the facade genuinely moves per seed now),
      222–308 waypoints each. So the 245 complaints were **artefacts of the
      NaN, not hidden defects**.
- [x] `check:park` on 5 seeds: `20260728`, `11`, `274`, `451` exit 0
      (canonical: `19/19 attractions route from the entrance, 0 rail
      crossing(s), 245/245 waypoints connected. All six invariants hold.`).
      **`LGP_SEED=128` exits 1** — `route.unreachable: 3`, `route.crossesRail:
      1`, `poi.stranded: 57`. **Pre-existing**: proved by running it in a
      detached worktree at base `ae20b9fc`, which gives the identical 3/1/57.
      Not this branch's, and not this slice's — reported to the Overseer.
- [x] `test:procgen` name diff vs base `ae20b9fc`: both `55 failed | 636 passed
      (691)`, and `comm` on the sorted failing-name sets is **empty in both
      directions** — no name added, none removed.
- [x] PR #674 open against `feat/procgen-on-sphere`

## Not my cause

The sibling engineer's `RIDE_SCALE` temporal-dead-zone crash is a **different
bug**. This one is an unbound module `let` read before the solve; that one is a
TDZ throw. No overlap, no duplicate work.
