# Engineering brief — stage 4, brought forward: a path that crosses the railway off-site is refused at commit, never thrown at planting

**Status: READY — dispatch now to the #511 Engineer**, as its own PR based
on the sphere branch (reviewable alone; lands before or with #511).
Authority: `docs/DESIGN-round-robin-generation.md`, "Seed 288,
root-caused (6 Sep)" — read it first; the ruling there is the spec. One
engineer, one worktree, normal CLAUDE.md discipline. Invisible on every
seed where nothing was crossing off-site (all of `main`'s pool today);
**visible on seed 288 on the sphere branch** — say which seeds' parks
changed and why in the PR body.

## The rule a reviewer looks for first

**One predicate, exported once from `crossings.ts`, asked by two
callers.** The `pathGraph` task's commit-time screen and the
construction-time `computeCrossings` must be the same function on the
same geometry (drawn samples, `TOUCH_DISTANCE`, `SITE_SNAP_TOLERANCE`).
A second "does this cross off-site?" written in `paths.ts` is the
two-definitions disease and is a rejection even while green.

## What this is

- The screen runs inside the generator's `pathGraph` task, **before**
  `offerPrewarmedPathGraph`, on the **drawn** samples of the candidate
  graph. **Corrected 6 Sep — the trap the first draft of this brief set:**
  at that moment `pathCentreline()` is *empty*; it is filled by
  `buildPaths()` at world-build (`Garden.ts:72`). A screen that reads it
  there scans zero samples, finds zero fouls and passes on every seed
  including 288 — a check that cannot fail. The samples must instead be
  **derived from the candidate graph** the task already holds:
  `ROUTES` = paved edges → `routeCurve(route)` → divisions →
  `recordSamples`, all computable with no mesh built. **That curve→samples
  step is extracted and shared** between `buildPaths()` and the screen —
  never its divisions formula (`max(24, round(len/0.8))`) copied into the
  screen, which would drift the first time path smoothness is tuned.
  A foul names the edge and is refused.
- Status of the pieces (6 Sep): the predicate is extracted and proved
  behaviour-identical — `createCrossingScan(route)` owns the flip,
  `siteForFlip(route, d)` owns the snap, `computeCrossings` is refactored
  **onto** both (canonical 90/90). `bridgeCandidateAt` is not new work:
  `crossingPlanSolve.ts:269`, already called at `:460`.
- **Scope split (Overseer, 6 Sep, Architect agreed):** the shared
  predicate + commit-time screen land first. The per-producer refusal
  ladder below is **held and sized from the screen's own transcript on
  seed 288** — it will say which producers actually foul, and the honest
  answer may be one, not six. Until the first rung lands, the screen
  turns 288's throw-at-planting into a **named refusal at commit** —
  better evidence, still a red seed, so #511 stays gated on that rung.
- **Sized (6 Sep)**: the 288 transcript names one producer,
  `spur-station-1` (station approach spur, `paths.ts:4060`). Ruled: fix
  that producer only — it gets the routed leg's rail screen — and leave
  the other five to the commit-time screen, which names them when they
  foul. Caveat in the PR body: one seed's transcript is one seed's
  evidence. The ladder below stays as the design's order for the next
  producer the screen names:
- **Amended 6 Sep — the first phrasing of this bullet produced a
  measured no-op (1342 samples → 1342, same foul).** Polyline tests
  (`segmentHoldsRailSide`, `enforceRailSide`) test control points; the
  fault is in the drawn Catmull-Rom, which bulges across the rail while
  the polyline holds its side. **A rung is: change a decision →
  resample through the shared `sampleCurve` → ask the same drawn-sample
  predicate at the point of decision.** Polyline tests may pre-reject a
  candidate, never accept one. In order of cheapness, each stated as
  what changes the *curve*: pin the curve with extra control points
  where it bulges (a Catmull-Rom passes through its points); straighten
  the run; take the next site / re-route; ask `bridgeCandidateAt(d)` for a
  site on demand at the **drawn** rail distance and add it if proven;
  otherwise a loud, named failure. Every rung's acceptance is the sample
  count *and* the foul count, before and after.
- The construction-time throw at `crossings.ts:432` stays and must
  become unreachable; `test:procgen` reports a park that cannot be built
  as a **failure** (#524 — land it here if it is not already merged, it
  is one harness change).
- Determinism: on-demand sites and re-routes take their order from the
  fixed candidate order and the seed, never from map iteration. Two
  builds per seed in separate processes, identical.

## What must not change

- `cruiserLowPoints()`'s 5.9 m. `SITE_SNAP_TOLERANCE`, `TOUCH_DISTANCE`,
  `SITE_SPACING`. The seed pool (288 stays). No new warp field.
- Parks on seeds where nothing crossed off-site: **byte-identical**,
  proved with `scripts/park-digest-sweep.sh` before/after on the base
  branch, hashes quoted. The digest exists for exactly this.

## Acceptance — measured

1. Seed 288 on the sphere branch builds; `seed-288.test.ts` runs its
   tests (not 90 skips) and passes. Say which edge was refused and what
   the next decision was, with coordinates.
2. Deliberate break on `main`'s geometry: move one canonical site by
   > 8 m along the loop in a scratch run; the router **refuses and
   re-routes** (transcript pasted with the edge and the site), and the
   build does not throw.
3. The predicate is one function: break it deliberately (make the task's
   screen use a stale copy with a different tolerance) → red run pasted.
4. Byte-identity on every seed that did not foul; change accounting for
   every seed that did, countersigned by the Architect.
5. Full gates green: `pnpm run check`, `pnpm run test:procgen`,
   `pnpm run check:coplanar`; exit codes captured directly; chain verified
   by parsing `scripts`.
6. Budget note on stderr: refusals per seed, on-demand sites proven per
   seed — the first crossing thrash number.

## Traps

- `bridgeKeepout.ts` memoises `footprints()` at module level; if the
  crossing set can change after a refusal, that cache is a stale read.
- `paths.ts` mutates module-level paving; never build twice in one
  process.
- `rerere` is on; rebuild any `check`-chain resolution from `main`'s
  parsed steps.
