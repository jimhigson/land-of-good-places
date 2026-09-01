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

## "Everywhere else" — measured, in the running park

There is no other reachable walk-through bench. Measured live, off
`world.collision`, not read off source:

- The park's stone benches (`Scenery.ts`'s `buildStoneWalls`) are already
  solid: a player-sized disc at the middle of each of the first six stone runs
  is blocked.
- The **bus-shelter bench** at (-9, 64.5) is **4.71 m outside the play
  boundary** (`playBounds.distanceToEdge` = −4.71). She can never stand there.
- The **station platform benches** at (39.96, −20.53) and (−33.74, −4.9) cannot
  be approached: a body marched at one from eight bearings never gets within
  2.29 m, and the walkable ground under them is the terrain (0.33 m), not the
  platform, so nobody ever stands on the platform to walk through the bench.

## Watched running (roof garden, port 5545)

- Walked head-on into the bench at local (5.14, 1.80): stopped dead at
  z = 602.78, which is `601.80 + 0.36 + PLAYER_RADIUS` exactly.
- Dropped a body at the bench's own centre: pushed out to 602.78 in one frame
  and stayed. No soft-lock.
- Dropped from 2.2 m onto it: lands at y = 1.168 = floor 0.728 + 0.44 and stays
  there — `topIsAbsolute` holds still under her rather than ejecting her.
- Walked off it: drops to the floor and keeps going.
- Jumped at it while running: sailed over, so it is not a pillar.

## Gates

- `pnpm run build` — exit 0.
- `pnpm run test:procgen` — **497 passed, 16 files**, exit 0.
- `pnpm run check` — see the PR body.
- `check:benches` proved red by thirteen mutations; the two that matter most
  are the pre-#459 meadow (median clump 0.75 m apart against a 0.39 m clump)
  and `FLOOR_SPACE_SPACING = 0` (a mall bench blocks 47 of 1333 points swept on
  the hall), which is the measurement that licenses the whole change.
