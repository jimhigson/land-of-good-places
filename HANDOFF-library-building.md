# HANDOFF — Library building (#716, part 2 of epic #714)

Branch `feat/library-building-716`, worktree `.claude/worktrees/library-building`.
Engineer (Opus). Owns the shared Chrome for this task.

## Scope (from the Overseer's brief)
1. `library` plot (parkManifest + anchors), solver-placed, camera-facing, every seed.
2. Pillared exterior on the plot (primitives behind `src/art/models/libraryAssets.ts`
   until the artist's `art/library-715` glb lands; then merge it and measure).
3. Interior: its own disjoint space at a far origin, 36 x 26 m, open-topped, shelves,
   desk, reading nook, instanced books, dim warm lighting, `LibraryLayout` table.
4. Door portal both ways (SpaceManager), save/restore via spaces.ts.
5. `/library` deep link.
6. `check:library` in the check chain; procgen invariant for the plot.

## Decisions (with reasons)
- **Origin (-600, -600)**: 849 m from the garden, 1200 m from the reptile hall
  (600, -600), 1213 m from the hotel lobby (-600, 613) — all past FOG_FAR (258 m).
- **Footprint is a circle, not the brief's rect 9 x 7.** Plots are axis-aligned and a
  camera-facing door turns the building 45 degrees (CAMERA_FACING_YAW), so an axis-aligned
  9 x 7 rect would not contain it. The honest footprint is the plinth's circumradius
  sqrt(9^2 + 7^2) = 11.40; bounding radius 11.5 as the brief asked.
- **Steps are walk surfaces, not colliders.** A `topIsAbsolute` collider 0.18 m tall is a
  wall to feet on the floor (`clearsTop` grace is 0.15 < 0.18), so it would make the steps
  unclimbable. The risers (0.18) are under `BUILDING_STEP_UP` (0.62); the plinth and step are
  platforms sampled in the building's own leaning frame (the castle's `castleSurfaceY` way).
- **Stacks run east-west, room-aligned, and fade when they hide her** (a sightline fade,
  FoliageFade's idea, per bookcase unit). The fixed camera looks from +X+Z at 38 degrees, so a
  3.2 m bookcase hides ~4 m of floor behind it.

## State
- (fill in as it goes)

## Checks run
- (fill in)
