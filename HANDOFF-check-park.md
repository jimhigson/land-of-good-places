# Handoff — `check:park` (branch `feat/check-park`)

**Status: done and green.** `npm run check:park` runs in ~225 ms and is wired
into `npm run build`. PR raised; do not merge it yourself.

## What is here

- `scripts/park-harness.mts` — builds the **real** `World` headlessly (real
  build order, real `CollisionWorld`, real solved train curve). Reusable by any
  future script that wants a park in Node.
- `scripts/check-park.mts` — the six invariants from ARCHITECTURE-DECISIONS
  Decision 5, measured against that park, plus the `RATCHET` table.
- `src/entities/TapNavigator.ts` — `SHORTFALL_TOLERANCE` exported (one word) so
  "she got there" means the same thing in the check as in the game.

## Two things a successor must know

1. **Node's `--experimental-strip-types` cannot load the world.** `DayNight`
   and `NavGrid` use TypeScript parameter properties. `check:park` therefore
   runs under `--experimental-transform-types`, unlike every other check.
2. **The ratchet is a ratchet.** A key with no `RATCHET` entry fails the build.
   A key that measures *better* than its entry prints `RATCHET LOOSE` and does
   not fail — tighten it in the same commit that fixes the thing.

## What the current park violates (all recorded, none silenced)

| key | measured | what it is |
| --- | --- | --- |
| `route.unreachable` | 1 | the ferris wheel's kiosk walls in its own anchor spur |
| `poi.nospot` | 1 | that same spur: no room for an NPC-width waypoint |
| `poi.stranded` | 7 | 7 of 41 waypoints in unreachable pockets, 4 of them "interesting" |
| `rail.exclusion` | 230.9 m | of 355 m of loop with no wall either side |
| `rail.walkable` | 347/355 | centre-line points a child can stand on |
| `anchor.reach:building` | +7.2 m | the ginormous slide reaches into the ball pit |
| `anchor.reach:dodgems` | +0.6 m | tuning |
| `anchor.reach:waterFight` | +1.3 m | tuning |

Invariants 2 (rail crossings) and 5 (boot asserts) **pass outright**, as does
anchor-plot disjointness and the scenery/lamp-post keep-out claim.

## Loose ends deliberately not taken

- `src/world/entrance/Entrance.ts` is **never constructed** anywhere on `main`,
  and `paths.ts` has no `spur-entrance` route, though both are referenced in
  prose. The checker uses `ENTRANCE_PLAYER_X/Z` from `entrance/layout.ts` as
  "the entrance" regardless, which is the coordinate Decision 5 pins.
- Invariant 6's collider-level attribution is by **scene graph** (each
  builder's `group`), not by collider ownership — `CollisionWorld` records no
  owner. A collider registered inside a plot by a builder not in the
  `scatterers` list is not caught. Adding an owner tag to `addCircle`/`addWall`
  would close it.
