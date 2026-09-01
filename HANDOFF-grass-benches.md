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

## What is solid on this branch, and what is deliberately not

| made solid | how |
|---|---|
| **26 deck benches** (8 mall, 8 hall, 10 roof) | rectangle, `topIsAbsolute` at 0.44 m, plus a `WalkSurfaces` plate so she can stand on one |
| **20 planters** (10 each on mall and hall) | circle at the pot's rim, `topIsAbsolute` at 0.70 m |
| **the roof pavilion** | rectangle, no top — a building is solid at every height |

Deliberately soft, with reasons:

- **The long grass.** Jim's own stated exception.
- **The bush on top of each planter.** The pot is masonry and stops her; the
  shrub is foliage, and brushing through leaves is what foliage is for. Making
  it solid would put a 1.5 m unjumpable hedge round the roundel. `topIsAbsolute`
  at the pot's rim is what expresses that as one collider rather than an
  argument, and `check:benches` asserts a body 0.3 m above the rim passes.
- **The pavilion's interior.** Not "soft" — *unreachable*, which is the other
  half of CLAUDE.md's rule. There is no doorway and the walls are 2.9 m against
  a 1.28 m jump apex.

## Still walk-through, and NOT in this PR

The general sweep Jim asked for ("everything else that isn't long grass") is a
second body of work. A crude probe of the mall's scene graph against the
collision world already names: **market-stall counters and awnings, the wooden
crates, the great hall's armour, plinths and goblets, the lift car and its
doors, the corner pillars.** Each needs a footprint decision and the same
in-and-out reachability proof, and doing them blind from a probe that measures
mesh *origins* rather than geometry would be guesswork. **The right deliverable
for that is an instrument first** — a geometry-aware audit that enumerates every
drawn mesh in the castle and the park and reports it as solid, unreachable, or
walk-through — and then fixes what it finds. That is PR 2.

## Watched running (roof garden, port 5545)

- Walked head-on into the bench at local (5.14, 1.80): stopped dead at
  z = 602.78, which is `601.80 + 0.36 + PLAYER_RADIUS` exactly.
- Dropped a body at the bench's own centre: pushed out to 602.78 in one frame
  and stayed. No soft-lock.
- Dropped from 2.2 m onto it: lands at y = 1.168 = floor 0.728 + 0.44 and stays
  there — `topIsAbsolute` holds still under her rather than ejecting her.
- Walked off it: drops to the floor and keeps going.
- Jumped at it while running: sailed over, so it is not a pillar.

## Watched running — the pavilion and the planters

- **Pavilion**, walked west at its east face (local x −7.35): stopped dead at
  x = **−6.71**, which is that face plus `PLAYER_RADIUS` less the 0.2 m inset.
- **Pavilion, the version that was reverted**: with a doorway she walked in
  (stopped by the far wall at x = −17.01, its inner face plus her radius,
  exactly), was stopped from inside by the north wall at z = 2.07, and walked
  back out through the door to x = +2.13. It worked, and she was **invisible**
  under the pyramid roof the whole time. That is why it is a sealed block.
- **Planter**, walked west at the pot at local (0.86, 8.76): stopped at
  x = **1.92** = rim + radius. Then slid round it and carried on **between two
  pots** to x = −2.22, inside the ring.
- **Planter, jumped**: at x = 0.80, directly over the pot, she was at
  y = **1.83** and sailed through to x = −11.41. Pot solid to feet, open to a
  jump, bush and all.
- Stood in the **middle of the roundel** at local (−4.24, 8.76): reachable.

## Gates

- `pnpm run build` — exit 0.
- `pnpm run test:procgen` — **497 passed, 16 files**, exit 0.
- `pnpm run check` — see the PR body.
- `check:benches` proved red by thirteen mutations; the two that matter most
  are the pre-#459 meadow (median clump 0.75 m apart against a 0.39 m clump)
  and `FLOOR_SPACE_SPACING = 0` (a mall bench blocks 47 of 1333 points swept on
  the hall), which is the measurement that licenses the whole change.
