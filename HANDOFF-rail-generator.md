# HANDOFF — one parameterised rail generator (issue #112)

Branch `feat/rail-generator`, worktree `.claude/worktrees/rail-generator`.

## Scope (from the Fable architect's verdict, do not re-litigate)

Build a general segment-based rail route generator; migrate **only** the Sky
Cruiser onto it. Train does **not** migrate. Rail Race does **not** migrate,
ever — it is a fixed perimeter circle by family ruling of 31 July, and its lane
fairness depends on staying one.

Also in scope: the missing castle/ferris-wheel horizontal clearance assert
(issue #113's first half), and a `ParkBoundary` seam for issue #115.

Not in scope: train migration, rail-race migration, the masonry-window castle
pass-through, implementing #115, the sleeper/tie-frame fix (another agent, on
`fix/tie-frame`, touching `Coaster.ts` ~line 330 and `rail/sweptRail.ts` —
rebase onto main before finishing).

## Two factual corrections to the brief, found by reading the code

1. **`checkCoasterClearances` is not in `scripts/check-park.mts`.** It lives in
   `src/world/coaster/route.ts:316`. `check-park.mts` contains no coaster code
   at all. The brief's description of *what it asserts* was right (cruise floor
   + 5.5 m train air, nothing horizontal), only its location was wrong.

2. **Its complaints never fail anything.** `Coaster.ts:112` only
   `console.warn`s them, and `park-harness.mts` swallows those warnings into
   `park.said`, printed only on `--verbose`. So even the checks that do exist
   cannot fail a build. The route.ts doc comment claiming "Reports and throws"
   is false.

   => the enforcement mechanism for the new clearance check is a **procgen
   invariant** in `test/procgen/invariants.ts` (runs on canonical + sweep seeds,
   blocks the merge in CI), with `checkCoasterClearances` also extended so the
   boot warning is genuine.

## Why the old horizontal solve could clip the castle

`route.ts:111-144`: a 200-pass loop that pushes each bearing's radius out of an
obstacle (line 121) and then **smooths the radii** (139-143). The smoothing runs
after the push and is never re-verified, so it can pull a bearing back inside
the castle. Note the contrast with the *vertical* pipeline, which explicitly has
a measure-the-finished-curve repair loop (202-258). The horizontal side had no
equivalent. That is the mechanism behind issue #113.

The old representation is radius-per-bearing — a star-shaped polar loop about
the origin. It cannot express an S-bend and cannot self-cross. The new one is
free-form, so self-crossing has to be forbidden explicitly (it is; see
`selfClearance` in `generate.ts`).

## Key facts about the code, verified

- `CoasterRoute` live public surface that must not change: constructor
  (`CoasterRouteOptions`), `.length`, `.stationDistance`, `.pointAt(d, target)`,
  `.tangentAt(d, target)`, `.wrap(d)`. Also present but read by nothing today:
  `.curve`, `.crestY`, `.clearanceAt`, `.nearestPoint`. I am keeping all of them.
- Consumers: `coaster/plan.ts` (only construction site), `coaster/Coaster.ts`,
  and `rail/sweptRail.ts` structurally via `RailSampler`. No script, no test.
- Everything is solved at module load, pure, from `PARK_LAYOUT` alone, before
  any scene object exists — `paths.ts` needs each ride's exit node first.
  Confirmed in `train/plan.ts`, `coaster/plan.ts`, `railRace/plan.ts`.
- Castle: `placedEntry('building')`, `boundingRadius` 19. Ferris wheel:
  `placedEntry('ferrisWheel')`, `boundingRadius` 13. Old code inflates both by
  +3 for track width.
- Boundary constants: `GARDEN_PLAY_RADIUS` 58, `GARDEN_HALF_SIZE` 62, wall at
  60, train owns the 48-58 m band, Rail Race ring at 53.5. Coaster's old band
  was `BAND_MIN` 16 / `BAND_MAX` 43.
- Seed sweep: `npm run sweep:seeds -- <from> <to>`, defaults 1..30. It shells
  `check-park.mts` per seed with `LGP_RATCHET=off`, which only hard-fails on
  `route.unreachable`, `route.crossesRail`, `boot.asserts`.
- `test/procgen/invariants.ts` has `railRaceFliesClear` but **no coaster
  invariant at all**. `INVARIANTS` list is at line 332.

## Design

- `src/world/rail/boundary.ts` — `ParkBoundary` seam + today's circle.
- `src/world/rail/segments.ts` — `Pose2`, `CubicSegment`, arc-as-bezier
  (`k = 4/3 * r * tan(theta/4)`), curvature sampling, G1 by construction.
- `src/world/rail/generate.ts` — the search: vocabulary, per-joint retry
  budget, backtrack, start-pose restart as the outermost level, analytic
  closer (single cubic, then two-cubic via seeded intermediate poses), one
  advancing RNG stream, throws a diagnostic report on exhaustion.
- `coaster/route.ts` — horizontal solve replaced by the generator; the vertical
  pipeline is kept but re-expressed in the **arc-length domain** instead of the
  bearing domain. That removes the bearing->metres conversion entirely, which
  is what the comment at old line 158-160 was patching around.

**Station position is the search's outermost level**: start poses are seeded
around the Sky Cruiser stall, and the loop closes back onto the start pose, so
the station is on the loop by construction. A start pose is only admissible if
the station window's ground is clear of plots — the track is at 1.1 m there and
is genuinely down among the scenery, unlike the rest of the loop which flies.

## Status

- [x] Worktree, survey, design
- [x] boundary.ts / segments.ts / generate.ts
- [x] CoasterRoute migration (public surface unchanged)
- [x] clearance assert + procgen invariant
- [x] `npm run build` passes; `npm run test:procgen` 55/55 across 5 seeds
- [x] turning-radius measurement (`npm run measure:rail-radii`)
- [x] sweep:seeds — 30/30 on this branch, 30/30 on origin/main, no regression
- [x] plan-view renders for the shape approval (`art-samples/cruiser-plan-*.png`)
- [x] rebased onto main incl. the tie-frame fix (#144); package.json conflict
      resolved keeping both `check:tie-frame` and `check:cruiser-solves`
- [x] **PR #148 open**
- [ ] live 3D screenshot — chrome-devtools was in use by #147; Overseer is
      queueing it. NOT a blocker for review, but the PR must not merge until a
      human has looked at the loop's shape.

## If you are taking over

Everything is committed and pushed to `feat/rail-generator`. The only work left
is the live browser screenshot, and re-checking the shape decision with Jim.

`npm run test:procgen` needs vitest, which is **not installed in the shared
checkout** (`/Users/jim/dev/landOfGoodPlaces/node_modules` has no vitest, and
this is true on main too — it is not something this branch broke). I installed
it into this worktree with `npm install vitest --no-save`. Worth telling the
Overseer: nobody can run the procgen suite locally without doing that.

## Hard-won findings — read before changing any tuning constant

**Tune against all the seeds, never the canonical one.** The first
configuration that solved the canonical park solved **5 of 21 seeds**. Use
`npm run check:cruiser-solves` with `LGP_SEED` set — it builds only the route,
so it answers in milliseconds where `check:park` takes seconds.

**The curvature check must catch cusps.** Sampling a cubic's curvature at 24
points let closer pieces with a **0.3 m cusp** pass a 12 m minimum-radius test,
because the samples straddled the cusp. `minCurvatureRadius` now samples 64
points *and* reports radius zero when a piece's speed collapses relative to its
own mean. Without that, the generator cheerfully returns loops with a hairpin
tighter than the one it exists to prevent.

**Close with biarcs, not Hermite cubics.** A cubic between two poses matches
both tangents but its curvature is whatever falls out — and between awkward
poses what falls out is that cusp. A biarc's two radii are *known* from the
construction, so an illegal closure says so exactly.

**Aim behind the station, not at it.** Steering at the start pose gets the head
within 7 m of home pointing the wrong way, which needs a 1-6 m radius biarc.
The search aims at an approach corridor `APPROACH_DISTANCE` (38 m) behind the
start, facing the same way, so the closer joins two nearly collinear poses.

**Two things that seemed good and were not** (both are commented in
`stationPoses` so they are not retried):
- Ordering candidate stations by how much open space is ahead of them: *slower*.
  The roomiest all sit in the same corner and fail identically, so the search
  grinds through near-duplicates before reaching a different one.
- Using that same measure as a filter: took every seed from **solvable to
  unsolvable**. A straight line is a bad predictor for a curved route, and it
  discarded exactly the stations that work.

**What actually made it solve**, in order of impact: a much wider station
window (the first cut demanded 22 m of clear ground in a park laid out with 5 m
corridors, and offered 2-24 stations; it now offers ~200); fewer, longer track
pieces, which shrinks an exponential tree; and `SAMPLE_STEP` of 1 m rather than
0.6 m, which alone took the worst seed from 4.8 s to 1.4 s.

**Budgets must be step counts, never wall-clock.** A time budget would make the
park come out differently on a slower machine.

## Numbers as built

- Canonical seed: 216 m of track, 10 pieces, tightest turn 12.8 m, solved in
  ~350 ms at module load. Old polar solve: 221 m, tightest turn **1.7 m**.
- All 21 seeds tried (canonical + 1..20) solve; worst solver time 1.4 s.
- `measure:rail-radii`: Sky Cruiser 12.8 m, Rail Race 57.4 m, train 6.6 m. The
  family's stated ordering (Cruiser < Race < train) **does not hold** — because
  the *train* turns tighter than the Rail Race. Reported, not fixed; the brief
  says not to bend the other two rides to match.

## The landmine: this changes the Sky Cruiser's shape

Same seed, different algorithm, different loop. The canonical park is
family-approved. Per `REQUIREMENTS-2026-07-28.md` precedent, a pinned-position
change needs a family screenshot check before it ships. **Checks passing is not
done.** The PR must sit reviewed-but-unmerged until a human looks at the shape.
