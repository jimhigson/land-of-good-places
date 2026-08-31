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

## Status

- [x] Root cause measured on all five seeds
- [ ] Implementation
- [ ] Invariant + mutation proof
- [ ] Counts re-measured, screenshots, PR
