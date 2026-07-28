# P1: she walks through walls when the frame stutters

Branch `fix/no-tunnelling`, worktree `.claude/worktrees/no-tunnelling`.

## Root cause

`CollisionWorld.resolve` is a **point test** — it asks where a mover *is*,
never what she crossed getting there. At `MAX_FRAME_DELTA` (1/12 s) a sprint
(11.1 m/s) moves **0.925 m** in one integration step. Step that far from just
outside a garden wall and she lands *past its mid-plane*; the resolver then
pushes out of the **nearest** face — now the far one — and she is through.
Deep enough (>`SHALLOW_OVERLAP`) it becomes a capped escort instead, which
walks her out the far side over two or three frames, and the escort latch
means her velocity is never zeroed so the next frame finishes the job.

It happens **at any height**: a collider she overlaps at neither end of the
step is never asked about her height, so `clearsTop` / `MAX_AUTO_HOP_HEIGHT`
are skipped entirely.

## Decision: sub-stepping, not a swept test

`CollisionWorld.resolveMovement(position, dx, dz, radius, clearance, dt)`
walks the frame's movement in pieces no longer than
`0.5 · (thinnestHalfWidth + moverRadius)` — 0.40 m for the park today — and
calls the *unchanged* `resolve` at each. Reasons, in order:

1. A swept test would be a second collision routine that has to independently
   reproduce the height rule, the two-pass corner handling, the shallow/deep
   split, the capped escort and the soft boundary. The measured hop clearances
   were measured against *this* resolver; a second answer invalidates them.
2. Perpendicular-distance reasoning holds at **every** approach angle: crossing
   a band of width `w` needs `w` of perpendicular travel, so a step shorter
   than `w` cannot cross it however it is pointed. A naive swept test against a
   wall's centre line does not have that property near a wall's ends, and a
   fence here is a chain of segments, so its ends are everywhere.
3. Cost is **zero** at ordinary frame rates: 60 fps sprint is 0.185 m, one
   sub-step, literally the old code path.

`dt` is divided among the sub-steps, so the depenetration escort still moves at
the same metres per *second* and the fling latch sees exactly what it saw
before.

## Files

- `src/world/Collision.ts` — `thinnestHalfWidth` (tracked at registration),
  `maxSafeStep`, `resolveMovement`, `checkSubstepBudget` (boot guard against
  `MAX_SUBSTEPS` ever binding).
- `src/entities/Player.ts` — `update` and `nudge` go through `resolveMovement`.
  `SPRINT_MULTIPLIER` moved to `constants.ts` as `PLAYER_SPRINT_MULTIPLIER`.
- `src/core/constants.ts` — `PLAYER_SPRINT_MULTIPLIER`, `PLAYER_LONGEST_STEP`.
- `src/Game.ts` — calls `checkSubstepBudget` beside `checkHoppableColliders`.
- `scripts/playerSim.mts` — **new**, the one shared faithful copy of
  `Player.update`'s integration. Both harnesses use it. `substepping: false` is
  the control that reproduces the old code.
- `scripts/measure-wall-tunnelling.mts` — **new**.
- `scripts/measure-hop-clearance.mts` — now uses the shared sim. Verified
  **byte-identical** output to the pre-refactor script with `substepping: false`.

## Measured

`node --experimental-strip-types --import ./scripts/ts-extension-resolver-register.mjs scripts/measure-wall-tunnelling.mts`

350k runs (wall / fence chain / right-angled corner × 7 half-thicknesses ×
6 approach angles incl. 85° glancing × 8 frame rates × walk/sprint × 96 frame
phases):

| | before | after |
|---|---|---|
| solid walls, tunnelled | 8895 | **0** |
| hoppable 0.7 m walls, tunnelled on foot | 246 | **0** |
| hoppable walls, flown over (the feature) | 71601 | 71686 |
| worst one-frame shove, solid | 0.749 m | **0.007 m** |
| peak speed | 11.10 m/s | 11.10 m/s (= sprint exactly; no fling) |

Hop clearances: unchanged everywhere except the 20 fps *sprint* rows (the only
swept case whose step exceeded the sub-step limit), which move down slightly
(e.g. 1.207 → 1.162). **Worst clean crossing over the park's own wall
thicknesses is still 1.045 m**, so `MAX_AUTO_HOP_HEIGHT = 1.0` still holds, and
every point still sits above `measuredHopCeiling()`.

Trajectory identity: exactly **0 divergence** with and without sub-stepping at
every frame rate where one sub-step suffices (30 fps up sprinting, 20 fps up
walking). Divergence appears only inside the band the old code could tunnel in.

## Verified in the browser, on the real park

424 colliders; thinnest half-width 0.20 m; sub-step limit **0.41 m**; three
sub-steps for the worst frame there is.

5235 sprint runs at every unhoppable wall in the park, 1/12 s frames, both
sides, square-on to 0.9-glancing, five timing phases, starting from positions
that overlap nothing:

- **with the fix: 0 crossings.**
- with the pre-fix integration monkey-patched back in: **2463 crossings** (47%).

405 runs at the hoppable garden walls: 0 crossed on foot, 248 hopped over.

Cost, measured in the page against those 424 colliders: `resolve` 1.14 µs;
`resolveMovement` on an ordinary 60 fps sprint step 1.02 µs (same — one
sub-step, same branch); on the worst 1/12 s frame, three sub-steps, 3.13 µs.
So a stuttering frame costs ~2 µs more out of 83,333 µs.

Boot console clean: both `checkHoppableColliders` and `checkSubstepBudget`
silent. `NavGrid` untouched (it never calls `resolve`); route over the hoppable
wall at z = 12 still planned straight across, cross-park route 1.4 ms.

## Still to do

- Raise the PR. Nothing else outstanding.
