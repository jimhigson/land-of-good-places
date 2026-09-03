# HANDOFF — issue #500, bushes through walls and trees

**Model: Claude Opus 5 (1M context).** Branch `fix/bushes-500`, worktree
`.claude/worktrees/bushes-500`. Probe worktree (read-only, delete when done):
`.claude/worktrees/bushes-500-probe` at 3a5b91d8 (the universal invariant).

## Build order — established, with the measurement

`World` line 100 `new Scenery(collision)`. Inside `Scenery`'s constructor:
`buildFoliage(collision)` runs **first**, then `buildWoodenWalls` /
`buildStoneWalls`. So at bush-scatter time:

- **trees exist** — planted earlier in the very same `buildFoliage`, and each
  has already registered its *trunk* circle (`0.55 * lean`) with `collision`.
- **walls do not exist in the collision world**, but `wallPlan()` is a fully
  solved pre-scene plan and is already what `tryPlantTree` consults
  (`clearOfWalls`). Same owner, so the fix belongs here, not elsewhere.
- **tree canopies are in neither** — `collision` holds only trunks. The canopy
  reach lives in `buildFoliage`'s own `planted` array, which is the array every
  tree is already refused against by its neighbours.

## The issue's numbers are badly understated — measured, whole pool

The issue says "~29 walls x bushes, 3 trees x bushes" across five seeds. Read
off a truncated vitest diff (it prints 8 of 188). Dumped the real foul list
from the invariant itself in the probe worktree — canonical seed alone:

    143 trees x bushes
     16 walls x bushes
     13 plots x paths     (not this ticket)
      5 slide legs x plots (#501)
      ... 11 others

My own instrument, replicating the invariant's shapes, over the five CI seeds
(canonical, 5, 11, 24, 131), BEFORE the fix:

| seed     | bushes | walls x bushes (worst) | trees x bushes (worst) |
|----------|--------|------------------------|------------------------|
| 20260728 | 286    | 16 (1.01 m)            | 143 (3.61 m)           |
| 5        | 263    |  7 (1.05 m)            | 116 (3.56 m)           |
| 11       | 203    |  5 (1.06 m)            | 109 (3.88 m)           |
| 24       | 358    |  8 (1.04 m)            | 149 (3.22 m)           |
| 131      | 354    | 28 (1.17 m)            | 136 (3.89 m)           |

Control: my instrument reproduces the issue's own examples exactly — seed 5's
`wood wall (24.9,-7.0)->(31.7,-7.0)` x bush 1.05 m, `(75.1,3.6)->(75.1,0.1)`
1.06 m, and `tree (-22.7,49.7)` x bush 1.69 m. So the tool is measuring the
right thing; the issue simply reported what fitted on screen.

Totals: **64 walls x bushes, 653 trees x bushes**, not 29 and 3.

## The fix

`src/world/Scenery.ts`, bush scatter. Three questions added, none of them a
list this loop owns:

1. `collision.isClearCircle(x, z, BUSH_GROUND_CLAIM)` — the real world as it
   stands at that moment. Deny by default; a future sibling system is covered
   for free.
2. `clearOfWalls(x, z, BUSH_GROUND_CLAIM, 0)` — the same pre-scene `wallPlan()`
   owner the trees ask. Gap 0 (new optional param, default `TREE_WALL_GAP`): a
   bush against a fence is a good look and legal; inside one is not.
3. `planted` — tree canopy reach, the same array trees are refused against.

Refusal **drops** the candidate; no clearance is shrunk.

Bush colliders are registered in a deferred batch after the loop, so a clump is
never refused by a sibling clump (see `acceptedClumps`'s doc).

## Done

- Fix + budget 4200 + invariant, all pushed.
- `test:procgen` exit **0** (536/536, 18 files), `check` exit **0**, `build`
  exit **0** — each read from the run's own log file, never through a pipe.
- Violation set diffed per park: **716 removed, 0 added**, zero remaining on
  all five seeds.
- Red proof taken and restored — see the PR body for the transcript, the
  geometry it was measured against, and the grep that verified the restore.
- Looked at it in a browser: matched daylight `/view` shots of the same fence
  on `main` and on this branch. Servers killed by PID, page closed.

## If you pick this up

Nothing is outstanding on the fix itself. Two things I found and did **not**
do, both worth their own ticket:

1. **`PlacedBush.radius` under-reports a clump.** It publishes the collider
   (0.85 m) while the drawn blobs reach 2.15 m, so both my invariant and the
   universal sweep can miss a leaf overhanging a wall the clump does not stand
   in. Stated in both places rather than quietly relied on.
2. **`world/Flowers.ts` has the same blind list**, one step smaller: it asks
   `isOnPath` and `clearOfCruiser` and nothing else — no walls, no trees, no
   collision world. Flowers are deliberately colliderless and tiny, so nobody
   has complained, but it is the same shape of bug.
