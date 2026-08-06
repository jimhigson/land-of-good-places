# HANDOFF — e-slide-fixes (PR #227 review fixes)

Branch `e-slide-fixes`, pushed to `feat/slide-parapet-gap`. Worktree
`.claude/worktrees/e-slide-fixes`. **Do not merge — Jim merges.**

Two review fixes, plus one measurement to report on #229 and **not** ship.

## Fix 1 — over-length route accepted (DONE)

`satisfies` had two clauses (length ≤ 75, height-sensitive complaint); the
post-solve guard in `planSlide` re-checked only the height one. When the
generator's unsatisfied fallback fires it hands back the first route that
merely *solved*, and `planSlide` accepted it.

**Proved red first.** Widening the pit rim from 3 radii to 9 (29 → 92 landing
poses) on seed 5 makes the fallback fire:

```
{"seed":5,"routeLength":90.28,"MAX_RIDEABLE_LENGTH":75,"overCap":true,"satisfied":false}
```

90.28 m against a 75 m cap, accepted, exit 0. Exactly the reviewer's number.

Fixed by giving the question **one owner**: `heightSensitiveComplaint(points)`
became `unrideableComplaint(route)`, which owns length *and* the two
height-sensitive checks. `satisfies` and the post-solve guard both call it, so
there is no second condition left to fall out of step.

Same 9-radius repro after the fix: **throws**, naming 90.28 m vs 75 m.

## Fix 2 — invariant asserted a guarantee nothing enforced (DONE)

`SLIDE_PLAN.facadeDoorMinX/MaxX` → `ShellPlan.slideGap` → **two dead readers**.
`buildCastle` early-returns on the facade branch and cuts only
`plan.doorMinX/doorMaxX` (the front entrance); the interior shell sets
`slideGap: null`. Confirmed independently.

**Chose: correct the claim, not wire up the geometry.** Because the geometry
should not exist. Measured with `probe-wall-crossing.mts` on all five seeds:

| | value |
|---|---|
| chute crosses south wall plane at | **y 14.84** |
| tallest masonry (crenellations) tops at | **y 10.29** |
| clearance | **4.55 m**, identical on all 5 seeds |

The chute **flies clear over the battlements**. Cutting a `slideGap` into the
curtain wall would notch masonry the chute passes 4.55 m above — fabricating
damage to make a test true. So:

- `invariants.ts` — the "leaves through its door" premise is false and is
  replaced by a clause that measures the built chute against the **built**
  masonry (the guarantee that actually keeps a child out of stone). The
  rules-vs-rules clause 1 and the planned-hole clause 3 are gone.
- `plan.ts` / `Shell.ts` — the dead fields documented as dead, with the number.
- PR body corrected.

This also **answers** the QA question the reviewer raised ("may fly clear over
the battlements") — it does, measurably, on every seed. What still needs eyes is
whether a chute launching from above the battlements *looks* right.

## The measurement for #229 — report only, DONE, nothing committed

Diagonal (anti-diagonal) attempt ordering **combined with** free landings.
**It works on 4 of 5 seeds**, and the rides come out better-shaped too.

| seed | baseline (pinned, start-major) | diagonal + free landings |
|---|---|---|
| 20260728 | 3.50 s / 68.8 m | **0.60 s** / 61.3 m |
| 2 | 3.69 s / 72.3 m | **0.84 s** / 65.7 m |
| 5 | 15.75 s / 73.0 m | **31.12 s** / 66.2 m |
| 11 | 6.73 s / 69.4 m | **1.72 s** / 63.6 m |
| 18 | 5.18 s / 66.5 m | **0.96 s** / 60.4 m |

Control — diagonal ordering with the pit still **pinned**, which reproduces the
previous author's reverted experiment on this machine:

| seed | reverted experiment (their number) | mine |
|---|---|---|
| 20260728 | 9.87 s | 9.65 s |
| 5 | 31.64 s | 32.48 s |

**Attribution:** seed 5's ~31 s appears with the pit pinned *and* free, so it is
caused by **diagonal ordering**, not by freeing the landing. And the canonical
seed goes 3.50 -> 9.65 s under diagonal-alone but 3.50 -> **0.60 s** under
diagonal+free: the two changes are not the sum of their parts, and free landings
*rescue* what diagonal ordering alone breaks. That is exactly the untested
combination the reviewer predicted.

**Caveat that matters.** The best-first ordering of the landing list dominates
the result. My first attempt ranked landings by `|straight_line - 60|`; the chute
wraps the tower so a route is ~3x the straight line (the pinned pit is 23.11 m
out and yields 66-73 m of ride). With that wrong target, **4 of 5 seeds failed to
solve at all** — canonical's best offer was 89.67 m against the 75 m cap.
Retargeting to `|3 * straight_line - 60|` produced the table above. So "free
landings" is not one experiment, it is a family of them, and the ordering
heuristic is the variable.

Experiment shape (reconstruct from here; **not committed**):
- `generate.ts`: anti-diagonal pairing, `for d in 0..S+E-2, for i in ...` .
- `plan.ts`: `freeLandingPoses()` — 4 m grid over `GARDEN_PLAY_RADIUS`, keep
  centres where `openGround` holds at the centre and 8 rim points at
  `BALL_PIT_RADIUS`, 4 headings each facing the middle, filtered by
  `approachIsClear`, sorted by `|3 * ride - DESIRED_LENGTH|`.

Posted to #229.

## Standards used

`npm run build` exit 0, `npm run test:procgen` **157 passed / 0 skipped** —
count read, not colour. Never piped through head/tail.

## Temp files (deleted before each commit)

`scripts/probe-slide-length.mts`, `scripts/probe-wall-crossing.mts` — probes,
not part of the PR. Recreate from this file's numbers if needed.
