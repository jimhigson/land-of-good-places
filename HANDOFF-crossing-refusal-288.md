# HANDOFF — stage 4 point 1: the crossing refusal (done), and the recovery (specified)

- **Model: Opus** (`claude-opus-5[1m]`), chosen by the Overseer. A replacement runs the same.
- **Branch:** `feat/crossing-refusal-288`, based on `feat/sphere-combined`.
- **Worktree:** `/Users/jim/dev/landOfGoodPlaces/.claude/worktrees/crossing-refusal`
- **Role:** Engineer. Reports to the Overseer. Does not merge.

## Status: point 1 complete, point 2 handed to the Architect

**Detection works and is proven. Recovery is not built, deliberately.**

Seed 288 still reports 1 off-site crossing. That is honest, not a regression:
the fouling decision is now **named at the point of decision** instead of
throwing out of scenery planting three systems later.

## What is built

- **`train/crossingPredicate.ts`** — the predicate, alone. A side flip of one
  drawn run's consecutive samples (`RUN_BREAK` stride guard, `TOUCH_DISTANCE`),
  snapped to a site within `SITE_SNAP_TOLERANCE`. Depends only on `TrainRoute`
  and `CROSSING_SITES`.
  **Why its own module:** `crossings.ts` imports `pathGraph.ts` imports
  `paths.ts`, so the router could never have asked it anything without a cycle.
  *That import direction is the whole reason the check could only run after the
  graph was committed.* Three askers now: the router, the generator's task, and
  `computeCrossings`.
- **`computeCrossings` refactored onto it** rather than keeping a copy that
  agrees today. Behaviour-identical: `seed-canonical` 90 passed.
- **Sampling has one owner** — `pathDivisions` and `curvePoints` in `paths.ts`
  beside `routeCurve`. `pathGraph.ts` asks for both. No second
  `max(24, round(len / 0.8))` anywhere.
- **The station approach spur is screened against the drawn curve**, and refuses.

## The control — keep all three legs, permanently

A screen that finds nothing on the broken seed is indistinguishable from a
screen that is not looking.

```
leg 1, must FIRE
  seed 288: 25 paved routes, 1342 drawn samples scanned, 1 off-site crossing
    FOUL railD 35.1 at (-36.2, 2.8), drawn by route "spur-station-1"
    (#17, width 2.6, 5 control points, (-22.6, 2.8) -> (-37.5, 0.1))

leg 2, must be SILENT (else a screen that fouls everything passes leg 1)
  20260728 1381 samples 0 · 5 1287 0 · 11 1455 0 · 24 1224 0
  131 1381 0 · 326 1238 0

leg 3, samples scanned printed every run, never zero; probe exits 2 on a
  zero scan rather than reporting a clean run.
```

**`railD 35.1, (-36.2, 2.8)` is the exact coordinate `crossings.ts:432` throws
at.** Same foul, caught at commit time — the evidence that the two askers ask
one question rather than two that resemble each other.

## Two findings that matter more than the code

**1. The polyline test is structurally unable to see this fault.**
`segmentHoldsRailSide` walks the straight segments between control points; what
is *drawn* is a Catmull-Rom through them, and it bulges. On 288 the control
polyline holds its rail side while the drawn curve crosses. Measured: screening
with it changed **not one of 1342 samples**. The brief was right —
*"the samples `recordSamples` produces, not the control polyline"* — and the
**ladder's** language ("shortened or bent until it holds its side") is a
polyline operation describing a curve fault.

**2. I reproduced the disease inside its own cure.** When `leadPlan` is null the
committed route falls back to `fallbackSpurRoute`, but the candidate I screened
was `[stationLead, approach, stand]` — geometry nobody lays. **`station-0` takes
exactly that path.** A screen measuring something it was not describing, inside
the fix for screens that measure something they are not describing. Caught by
instrumenting, not by reading.

Twice now, **instrumenting beat reading, and both times the thing that looked
right was wrong in a way no exit code would have shown.**

---

# SPECIFICATION for the Architect — the recovery rung

Detection is done. What follows is what "take the next decision" has to mean,
and why it is a contract between two generators rather than a local fix.

## The trigger

The router has a candidate route, has curved and sampled it exactly as
`buildPaths` will draw it, and `screenDrawnPathsForOffSiteCrossings` returned a
foul at rail distance `d`. Two cheaper rungs are already exhausted on seed 288:

1. the appendage screen (done — it refuses), and
2. bending the appendage by routing to the approach instead of the lead
   (built — **also fouls on this seed**).

## What must be asked

`bridgeCandidateAt(d)` — **already exists** at `crossingPlanSolve.ts:269` and is
already called at `:460`, so this is not new machinery. It answers "could a
bridge be proven here?" for a rail distance.

- **If it proves a site**, that site must become part of `CROSSING_SITES` so
  `siteForFlip` snaps to it and the crossing is legal. This is the design's
  "sites are candidates, claimed when a conflict needs one".
- **If it proves none**, the segment re-routes (the router takes its next
  decision), and if nothing serves, the failure is loud, names the seed and the
  edge, and is a **test failure** (#524) — never a skip, never a throw.

## The collision that makes this the Architect's, not an Engineer's

**`bridgeKeepout.ts` memoises `footprints()` at module level**, and
`footprints()` calls `computeCrossings`. If the crossing set can grow *after*
that cache is warm, every later reader gets a stale answer — foliage, lamp
posts, and the bridge keep-outs themselves. So claiming a site on demand needs
one of:

- a defined point before which sites may still be claimed and after which they
  are frozen (and an assertion that nothing claims later), or
- an invalidation contract that `bridgeKeepout` and every other memoising reader
  honours.

Either is a **contract between the path generator and the crossing planner**,
which is why it wants designing rather than guessing. `paths.ts` also mutates
module-level paving, so nothing may build twice in one process while resolving
this.

## Acceptance, unchanged from the brief

Byte-identity on every seed that did not foul (`park-digest-sweep.sh`, hashes
quoted); the deliberate `> 8 m` site move on `main`'s geometry caught by the
refusal path; determinism from the fixed candidate order and the seed, never map
iteration; two builds per seed in separate processes, identical.

## Forbidden, restated

Widening `5.9`, `SITE_SNAP_TOLERANCE`, `TOUCH_DISTANCE` or `SITE_SPACING`.
Dropping seed 288. Any new warp field — `banCrossingsAt` removes sites, so a
field that adds one is the same disease with the sign flipped.
