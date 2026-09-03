# Handoff — the road outside the gate (#487 road ends + grey, #488 bus clips the rail race supports)

Branch `fix/road-487-488`, worktree `.claude/worktrees/road-487-488`.

## Measured facts (canonical seed 20260728, `scripts/measure-entrance-road.mts`)

Run with:
`node --no-warnings --import ./scripts/ts-extension-resolver-register.mjs scripts/measure-entrance-road.mts`

- Road today is two ribbons (`Entrance.ts` `buildEntranceRoad`):
  - `entrance-road-kerb` x **-29.92..14.92**, z 65.11..72.89 (centre z = `ENTRANCE_BUS_STOP_Z` = 69)
  - `entrance-road-gateway` x -3.89..3.89, z 57.51..65.11
- **Six rail-race trestle legs stand inside the kerb road's footprint** on the
  canonical seed: (7.26, 68.87), (5.37, 68.20), (-16.16, 67.92), (-18.09, 68.46),
  (-6.36, 66.05), (-4.36, 66.04). The bus runs x 7 -> -22 along z = 69, straight
  through them. That is #488, and it is not bad luck: the kerb road runs
  **parallel to, and at the same radius as, the two rail-race rings** (both rings
  are boundary-following loops ~6-11 m outside `ENTRANCE_WALL_RADIUS`).
- Gaps between neighbouring legs along the kerb line are only ~9.5 m; the bus is
  18.2 m long, so no straight kerb at this radius can thread them.
- Terrain along the kerb (z=69) is flat (y -0.46..+0.46) out to |x| ~ 47, where
  `TERRAIN_RADIUS` (83.5) cuts the ground disc. Going **east** the kerb line
  re-enters the park boundary at x ~ +27 (the boundary spline bulges to 92 m off
  the gate bearing), so a straight kerb cannot simply be extended both ways.
- Radially outward from the gate (x=0): flat to z=72, then the rim falls
  -1.35 m at 74, -14.2 m at 80, bottoming at -17 past 84. `RIM_OUTSET_START/END`
  = 12/22 m beyond the park edge, `RIM_DROP` = 17.

## Build order matters

`World.ts`: `RailRace` is constructed at line 214, `Entrance` at 268. So the
entrance road **can** see the trestle colliders already in the shared
`CollisionWorld` and backtrack against them. The reverse is not true.

## Grey (#477 restated)

`roadMaterial()` has exactly two call sites — `Entrance.ts:648` (park/gameplay)
and `BusJourney.ts:1256` (the intro ride's own Scene). So the seam already
exists; giving `roadMaterial` a tone and passing `'grey'` from `Entrance.ts`
only changes gameplay. The cancelled branch `origin/fix/grey-arrival-paving`
already did exactly that (3 commits) and is worth cherry-picking.

## Zoom-out extent owner

`IsoCamera.frustumBase()` = `max(CAMERA_VIEW_HEIGHT/2, CAMERA_MIN_VIEW_WIDTH/2/aspect)`;
half-height at full zoom-out = `frustumBase / CAMERA_ZOOM_MIN` (0.42).
Aspect-dependent, so any road length taken from it must be taken from the same
function, not a copied number.

## Status

Measuring. Nothing implemented yet.
