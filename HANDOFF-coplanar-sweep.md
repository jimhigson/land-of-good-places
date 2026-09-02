# HANDOFF — coplanar sweep (#472)

Branch `feat/coplanar-sweep`, worktree `.claude/worktrees/coplanar-sweep`.
No browser, no dev server: this is a headless geometry tool.

## State

Done and pushed. Remaining: full `pnpm run check` / `test:procgen` / `build`
exit codes, then the PR.

## What was built

| file | what |
|---|---|
| `scripts/coplanar-sweep.mts` | the measurement — world-space triangles bucketed by plane, area overlap between different meshes, same-facing only |
| `scripts/coplanar-rank.mts` | the sight line (can a camera see it) and the reach (how close can a child stand), and the ordering |
| `scripts/check-coplanar.mts` | the gate: five seeds, every space, ratcheted |
| `scripts/coplanar-baseline.mts` | generated; 234 entries |
| `test/coplanar/sweepControls.test.ts` | eight controls on the instrument |

`pnpm run check:coplanar` — also wired into the `check` chain after
`check:assets`. Step-set diff before/after was exactly one addition, nothing
dropped (CLAUDE.md's rule).

## Numbers, as of 2 September 2026, seed 20260728 + 5, 11, 18, 24

**234 seams, 10 spaces, 70 s.** 92 fighting at 0.1 mm; 142 more held apart by a
stand-off under 1 cm; 168 of the 234 buried where no camera can reach them.

Raw before aggregation: 11.8 M triangles → 1.81 M front-facing and over 1 cm²
→ 543 seams on the canonical seed alone (397 of those occluded).

## Decisions worth not re-deriving

- **`visible` is ignored.** 3841 of 5543 meshes are `visible=false` at build
  time, because the castle interior root and the hotel rooms are hidden until
  you walk in. Honouring it would sweep the park and skip every interior —
  which is where the last two of these bugs were.
- **`Float64Array`, not `Float32Array`.** The hotel is 600 m out; a 32-bit
  float resolves ~6/100 mm there, coarser than the 0.1 mm tolerance. The
  control test's "600 m from the origin" case is what fails if anyone narrows
  it.
- **Plane separation is measured from each triangle's own vertex**, never from
  a world-origin plane offset `d`. At 600 m, a 0.001 difference in normal turns
  into 0.6 m of phantom separation.
- **Instances of one `InstancedMesh` are one object.** The world has never had
  a frame run on it, so the ferris gondolas and the hotel's disco motes are all
  still stacked at t = 0. Treating those as findings buried the real ones under
  two hundred of them.
- **The hash key is (world 4 m cell) × (normal cell, 27-neighbour probe).**
  A triangle is inserted into every world cell its box covers, so the grid
  cannot lose a pair; only the normal needs neighbour probing.
- Occlusion is one ray from the largest overlap's centre. Occluded seams are
  still reported and still ratcheted — they rank zero, they are not hidden.

## Proved red — transcripts, with the geometry they were taken against

Both against `src/world/entrance/Entrance.ts` at `72d526f4`:

1. `textPlane.position.set(0, 2.6, faceSide * 0.105)` → `* 0.1`, which removes
   the 5 mm stand-off between the welcome sign's mount and its text plane:

   ```
   TIGHTER: garden|entrance/welcome-sign/<Mesh:BoxGeometry>|entrance/welcome-sign/<Mesh:PlaneGeometry>
         now fighting at 8.9e-10 m; it was a stand-off when the baseline was taken
   ```
   exit 1.

2. A new `PlaneGeometry(2, 1)` named `deliberate-defect` added to `signGroup`
   at `(0, 2.6, 0.08)` — flush with the board's own front face:

   ```
   NEW: garden|entrance/welcome-sign/<Mesh:BoxGeometry>|entrance/welcome-sign/deliberate-defect
         2.000 m² of shared plane, fighting now at 1.8e-9 m, seen on seed 20260728
   ```
   exit 1.

Both reverted; the check is green at exit 0 on the unmodified tree.

## If you pick this up

The backlog it produces is #467's list plus more. Fixing any of it is a
separate ticket — when a seam is fixed, `check:coplanar` prints
`BASELINE LOOSE` and asks for the line to be deleted from
`scripts/coplanar-baseline.mts`.
