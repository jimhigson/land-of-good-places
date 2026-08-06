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

## The measurement for #229 — report only, do not ship

Diagonal attempt ordering **combined with** free landings, five seeds. The
previous author measured diagonal ordering only against the pinned 29-pose pit.
See the numbers posted to #229. Nothing from this experiment is committed.

## Standards used

`npm run build` exit 0, `npm run test:procgen` **157 passed / 0 skipped** —
count read, not colour. Never piped through head/tail.

## Temp files (deleted before each commit)

`scripts/probe-slide-length.mts`, `scripts/probe-wall-crossing.mts` — probes,
not part of the PR. Recreate from this file's numbers if needed.
