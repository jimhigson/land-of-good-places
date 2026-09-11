# HANDOFF — `check:coplanar` green on `feat/sphere-combined` (PR for #600)

**Model: Opus** (chosen by the Overseer; a replacement must also be Opus).
**Role:** Engineer. Reports to the Overseer. Does not merge.

**Status: done, green, PR open against `feat/sphere-combined`.** Left here only
so whoever picks up issue **#612** knows what was measured and why it was split
out.

- **Branch:** `fix/coplanar-sphere`, rebased onto `origin/feat/sphere-combined`.
- **No dev server started, no browser page opened.**

## What landed

Four findings, all closed:

1. **Nine `BASELINE LOOSE` entries** deleted by hand (not by `--print-baseline`,
   which would have banked the worse live numbers at the same time).
2. **`deck|shell`** — the bridge's invisible clearance marker carries no faces
   (`setIndex([])`), so it cannot share a plane. It keeps its eight corners and
   its name; both readers take `.min.y` off the position attribute, which is
   blind to the index, and all three raycasters exclude it by name already.
3. **`shell|wallTop`** — `snapToWallTop` snaps any course rung within
   `COURSE_RECESS` of a ring's own wall top *to* it, so the leftover sliver
   collapses and the existing clause deletes its reveal by the rule it already
   had. The old "16–77 mm vs 1.5 mm" calibration is dead: instrumented across
   ten seeds, 16856 reveals, the height above the reveal is a continuum from
   zero, so no threshold would have been honest.
4. **`boundary-blocks|rail-fence`** — baseline entry **re-taken upward**, with
   its full reason in the file, pointing at **#612**. See below.

## The fourth one, and the two things it cost

**The inherited proposal was wrong and is reverted.** It made the drawn wall
give way to the railway. Measured with an instrument that was controlled first —
on the base it finds exactly one gap per seed, on all ten, the gate at (0, 60),
12.7–14.4 m — the proposal cost seed 326 **89.2 m of wall in one hole**, seed 451
96.8 m, and the canonical seed 60.4 m in three holes. The collision ring being
left whole made it worse: an invisible wall across a 78 m hole.

**The real defect is on #612**, root-caused and fixed there in full:
`rail/generate.ts`'s `boundaryMargin` was documented as coming from
`train/route.ts`'s `TRACK_BOUNDARY_CLEARANCE`, **a constant that never
existed**, and fell through to `?? corridorRadius`. The fix works (closest
approach 1.83 m → 3.14 m) and **was reverted off this branch on measurement**:
`vet:seeds --pool` goes 8/10 → 1/10, and five of the eight regressing seeds
carry no warp vector to re-bake. Any added constraint prunes the route DFS and
changes which loop closes first, so seeds that never needed the margin re-solve
too — seed 11 was already 4.83 m clear and its loop still moved 334 m → 325 m.

**Why no narrow fix was taken instead.** The seam is a course-0 block's top face
against a fence rail's top face, 2–3 mm apart (326: −1.823 vs −1.825; 128:
−3.526 vs −3.529), because `Garden.ts`'s course height and `fence.ts`'s rail
height are two unrelated `0.62`s that happen to be equal. Moving one relocates
the coincidence rather than removing it. ART_DIRECTION §7's delete-the-hidden-
face does not apply: nothing is hidden, the posts are 0.95 m against a 0.62 m
course and a metre of every offending rail is in open air. **Two solids that
interpenetrate will always put some pair of faces in a shared plane.**

## Two red things on `feat/sphere-combined` that are NOT this branch's

Found by running `vet:seeds --pool` on the base as a control (8/10). The
Overseer has taken both:

- **seed 428** — `the road's corridor claim is the road it drew`, plus two more.
  Red on the base and on this branch identically.
- **seed 208** — `the Rail Race finish rainbow stands on the ground`.

## Traps that cost real time here

- **A world `Box3` of a Y-rotated box is its axis-aligned hull**, and hulls
  touch long before boxes do — a 1.63 × 0.70 m block at 45° reaches 1.65 m
  against a true 0.85 m. An invariant written that way was red on a clean seed
  451 (hull 15, exact 0). Use SAT on the four XZ axes plus a Y interval.
- **Importing `BOUNDARY_MASONRY_HALF_WIDTH` from `Garden.ts`** into anything the
  path graph reaches is a module-load cycle (`Cannot access 'TRAIN_PLAN' before
  initialization`). `tsc` is perfectly happy with it. It has to come from
  `boundary.ts`.
- **A probe that imports only `train/plan.ts` calls a failing seed solved** — a
  route can close and still prove no bridgeable crossing, which throws in
  `crossingPlan.ts`. Import that too.
- **A child process ending with `process.exit(0)` has stdout truncated at 65536
  bytes.** Write a file per seed.
- `POSES_OFFERED = 160` and a denser `TRAIN_LENGTH_FRACTIONS` ladder were both
  tried for #612's seed 326 and **rejected on measurement** — more rungs close
  but none satisfy, at 16 s → 2 min. Do not revisit without a new reason.
- **`pgrep -f <name>` matches the shell running it.** A wait-loop written that
  way never exits. Guard on a PID.

## Gates, all run on this branch

`check:coplanar` 0 · `check` 0 · `test:procgen` 0 (601 passed) · `build` 0 ·
`check:swept-bus` 0 · `check:park-pool` 0.
