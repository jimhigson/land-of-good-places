# HANDOFF — longer, denser long grass; benches solid everywhere (#459)

Branch `feat/grass-and-solid-benches`, worktree `.claude/worktrees/grass-benches`.
Dev server port **5545** (`--strictPort`), killed by PID.

## The ask

Jim: *"Long grass needs to be longer and more dense, benches need to be solid
(can't walk through them) on the roof garden and everywhere else."*

## What is where

- **Long grass** is only ever the roof garden's: `src/world/building/roofMeadow.ts`.
  Two instanced meshes, turf discs and blade clumps, one per meadow cell.
  Nothing in the park draws long grass.
- **Benches a child walks through** are the castle deck benches,
  `src/world/building/dressing.ts` — 8 a deck, 10 on the roof, an `InstancedMesh`
  of 2.2 × 0.44 × 0.72 boxes with **no collider at all**.
- **Park benches are already solid.** They are the stone runs in `Scenery.ts`
  (`buildStoneWalls`), registered with `collision.addWall(..., run.height, true)`.
  Nothing to do there. The station platform bench and the bus-shelter bench are
  props inside furniture a child cannot get behind — see the checks.

## The prohibition that used to forbid the fix

`dressing.ts`'s `keepOutsFor` doc said castle props get no colliders because
indoor collision is height-blind. Collision is still height-blind, but since
the floor split (#377/#380) the three floors are 300 m apart in world space,
so a collider on one blocks nothing on the others. Same correction PR #453
made for the banquet tables; this branch is cut from `main`, which does not
have it yet, so the wording is re-derived here rather than merged.

## Decisions

- Bench colliders use **`topIsAbsolute`** at the bench's real 0.44 m top —
  solid to feet on the floor, air to a jump, still there beneath feet standing
  on it. `hotel/place.ts` is the precedent.
- **No hollow middle.** `addRectangle` is four walls, and inset by the 0.2 m
  half-thickness the bench's own half-depth (0.36) goes to 0.16 — so the two
  long walls' stadiums overlap and cover the whole footprint. Proved by
  `check:benches`'s trap probe, not by this paragraph.
- Bench tops are a `WalkSurfaces` platform, so a jump onto one lands on it.
- Grass: **`TUFTS_PER_CELL`** multiplies clumps without touching the meadow's
  cell grid (which is also where the wild animals may stand and how the patch
  outline is resolved), and `MEADOW_GRASS_HEIGHT` goes up. `WildPets`' `PET_TOP`
  is already derived from the grass height, so the animals stay half-hidden.

## Gates

`pnpm run check`, `pnpm run test:procgen`, `pnpm run build` — see the PR body
for the numbers actually off the screen.
