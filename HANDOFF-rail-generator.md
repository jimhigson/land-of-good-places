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
- [ ] boundary.ts / segments.ts / generate.ts
- [ ] CoasterRoute migration
- [ ] clearance assert + procgen invariant
- [ ] build, sweep, turning-radius measurement
- [ ] screenshots for family shape approval
- [ ] PR

## The landmine: this changes the Sky Cruiser's shape

Same seed, different algorithm, different loop. The canonical park is
family-approved. Per `REQUIREMENTS-2026-07-28.md` precedent, a pinned-position
change needs a family screenshot check before it ships. **Checks passing is not
done.** The PR must sit reviewed-but-unmerged until a human looks at the shape.
