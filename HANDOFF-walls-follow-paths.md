# HANDOFF — walls alongside paths (issue #417)

Branch `feat/walls-alongside-paths`, worktree `.claude/worktrees/walls-follow-paths`.
Dev server port **5420** (`--strictPort`), killed by PID.

Jim, 31 Aug: *"outside, the walls are placed seemingly at random. They should be
alongside the paths and flush with it at various places. Same number of walls,
but no wall in the middle of a patch of grass for no reason"*

## Root cause — measured, not guessed

Issue #300 already moved wall placement from "free (angle, radius) on the lawn
disc" to "anchored to a path border segment or a plot". That is why
`wallsBorderTheGridSensibly` exists. It did not fix what Jim is seeing, because
the anchor is *only a starting point* and both offsets are large.

Measured on the built park (`test/procgen/zzMeasureWalls.test.ts`, temporary
harness, deleted before PR — see git history), distance from every wall run to
the nearest **paved surface**:

| seed | walls | stranded (>4 m from any paving) | nearest wall gets to paving |
|---|---|---|---|
| 20260728 | 27 | 15 | 3.37 m |
| 2 | 35 | 28 | 3.52 m |
| 5 | 25 | 22 | 3.45 m |
| 11 | 28 | 23 | 3.53 m |
| 18 | 40 | 28 | 3.34 m |
| **total** | **155** | **116 (75%)** | **3.34 m** |

Three separate mechanisms, all in `src/world/Scenery.ts`:

1. **Nothing can ever be flush.** `runIsClear` requires
   `isPlantable(x, z, 3.2)` at every sample, and `isPlantable` calls
   `isOnPath(x, z, clearance)`. So a wall is *structurally incapable* of coming
   within 3.2 m of paving. `PATH_BORDER_OFFSET_MIN = 3.6` exists to respect
   that. Across all five seeds the closest any wall gets is **3.34 m** — over
   five player-radii of grass, always. Jim's "flush with it at various places"
   is currently impossible by construction.
2. **The plot-anchored branch strands walls far from any path.** 35 % of
   candidates (`useAPlot`) anchor to a plot's bounding circle at
   `PLOT_BORDER_OFFSET_MIN..MAX` = 6.2–9.5 m beyond it, with no reference to a
   path at all. These are the egregious ones: seed 11 `(-89.7,41.5)` sits
   **37.5 m** from the nearest paving; seed 2 `(74.8,57.4)` 34.8 m; seed 5
   `(-84.6,5.4)` 27.4 m. Those are literally walls in the middle of a field.
3. **The maze L's outward arm walks further out.** Arm B extends 3.5–5.5 m
   *away* from the bordered thing, and `WALL_BORDER_MAX_DISTANCE = 11` lets a
   tip land 11 m from anything (worst measured 11.04 m, seed 5).

`wallsBorderTheGridSensibly` cannot see any of this: its
`WALL_BORDER_PROXIMITY_TOLERANCE` is **14 m**, and it counts *plots* as a thing
worth bordering — so a wall 37 m from paving but 7 m outside a plot circle
passes it comfortably. That invariant is not wrong, it is just answering a
different question. The new one answers Jim's.

## Plan

- Split the wall's path clearance out of the 3.2 m plantable clearance so a run
  may sit at the kerb; draw the offset from `[0, ~3]` so some are flush and the
  rest vary.
- Anchor every wall to a **path** border segment (drop the plot branch): every
  plot already has an approach spur, so a wall still squares off a building's
  corner — via that building's own path.
- Raise the candidate budgets to hold the count. **Counts must match.**
- New invariant: every wall run has a point within a player-derived distance of
  real paving, and some are genuinely flush.

## Where the two numbers come from

Both derived, neither typed — the Overseer asked for this explicitly.

- **Flush** = `WALL_PAVING_CLEARANCE` = `WALL_HALF_WIDTH.stone + 0.04` = 0.40 m.
  A wall's face touches the kerb exactly when its centre stands its own
  half-thickness back. The 4 cm is a z-fighting allowance (kerb and wall base
  are both at ground level), not a spacing choice.
- **Alongside** = `PATH_BORDER_OFFSET_PATH_WIDTHS` = 2, i.e. the verge may be
  up to the *bordered path's own half-width × 2* — one full path width. A grass
  strip as wide as the path beside it still reads as that path's verge. Routes
  are 2.6–3.6 m wide, so the offset range is 0–2.6 m on a spur and 0–3.6 m on
  the main loop, and it **varies with the path** rather than every wall sharing
  one constant.
- **Stranded** = `wallAlongsideMax()` = `widestPathHalfWidth × 2 +
  PLAYER_RADIUS`, read off the network the park actually built. The
  player-radius slack covers the bow between a route's control polygon (which
  the placer positions against) and the drawn Catmull-Rom curve (which is the
  paving).

## After the placement change (budgets not yet tuned)

| seed | walls before | walls after | stranded before | stranded after | nearest paving before | after |
|---|---|---|---|---|---|---|
| 20260728 | 27 | 42 | 15 | **0** | 3.37 | **0.43** |
| 2 | 35 | 31 | 28 | **0** | 3.52 | **0.44** |
| 5 | 25 | 28 | 22 | **0** | 3.45 | **0.47** |
| 11 | 28 | 20 | 23 | **0** | 3.53 | **0.43** |
| 18 | 40 | 41 | 28 | **0** | 3.34 | **0.39** |
| total | 155 | 162 | 116 | **0** | | |

Furthest any wall point from a path or plot: 10.8–11.0 m before, 6.1–7.5 m now.

**Counts still need work.** Aggregate is close (155 → 162) but the mix moved:
wood 92 → 70, stone 63 → 92, and seed 11 fell 28 → 20 while canonical rose
27 → 42. Levers are `MAZE_CANDIDATES` (2600) and `BENCH_CANDIDATES` (4200).
Raise the first, lower the second. **Do not fix this by loosening the
placement rule.**

## Final numbers

| seed | walls before | walls after | stranded before | stranded after | nearest paving before | after | worst approach after |
|---|---|---|---|---|---|---|---|
| 20260728 | 27 | 35 | 15 | 0 | 3.37 | 0.43 | 2.91 |
| 2 | 35 | 28 | 28 | 0 | 3.52 | 0.44 | 2.97 |
| 5 | 25 | 29 | 22 | 0 | 3.45 | 0.47 | 3.16 |
| 11 | 28 | 22 | 23 | 0 | 3.53 | 0.43 | 2.50 |
| 18 | 40 | 41 | 28 | 0 | 3.34 | 0.39 | 2.83 |
| **total** | **155** | **155** | **116** | **0** | | | |

Wood 92 → 88, stone 63 → 67. Flush runs (face within `PLAYER_RADIUS` of
paving): 0 → 9 / 9 / 8 / 9 / 11.

**The count knob is spacing, not budget.** `BENCH_CANDIDATES` 4200 → 1300 moved
the canonical seed only 26 → 22 stone: acceptance is packing-limited. So
`MAZE_CORNER_SPREAD` 12 → 7 and a new `BENCH_SPREAD = 9`. No clearance was
touched to achieve this.

## Exit codes

- `pnpm run test:procgen` — **0**, 487 passed, 16 files, all five seeds.
- `pnpm run build` — **0**.
- `pnpm run check` — `check:park-boot` red on the loaded box, **green on its own
  re-run (exit 0)**; that is #324. Everything before it in the `&&` chain passed
  (including `check:park`, `check:waypoints`, `check:nav-routes`);
  `check:arrival-completes` run separately, exit 0.

## #414

Verified by merging `origin/fix/paths-planned-before-bridges` into a scratch
branch: procgen 486/487, and the **one** failure (`no paved path stops anywhere
but a destination`, seed 5) reproduces on **#414's branch alone with none of my
code**. Not mine — reported to the Overseer. All wall invariants including the
new one passed on the combination.

## Status

- [x] Root cause measured on all five seeds
- [x] Placement implemented — anchors are paths only, offset flush-to-one-path-width
- [x] Count held: 155 → 155
- [x] Invariant + both claims proved red by separate mutations
- [x] Exit codes recorded
- [x] Before/after screenshots, 30 images, `/tmp/qa417`
- [x] Verified against #414's branch
- [ ] PR raised; needs a real rebase once #414 merges
