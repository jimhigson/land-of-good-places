# HANDOFF — ride-exits (GAME-BREAKING: trapped-in-booth fix)

## Root cause
`Coaster.arrive()` placed the player 40% of the way from the station stall's
centre to its doormat (`stall.entranceX/entranceZ`) — still inside the
booth's four walls (`minigames/stalls.ts` builds a real 4-wall kiosk around
every stall). No walkable way out. `player.endRide()` was called, so control
returns to the player, but she is boxed in.

## Design implemented (per REQUIREMENTS-2026-07-28.md §1)
1. `src/world/coaster/plan.ts` — new, mirrors `train/plan.ts`: `COASTER_PLANS`
   (`cruiser`, `race`) solved at module load from `PARK_LAYOUT`. Cruiser
   solved first (race avoids it, per `CoasterRoute`'s existing `avoid`
   option). Each plan carries `route`, `stationStallId`, and `exitX/exitZ`
   (beside the station, on the far side from the booth, slid until
   `clearOfPlots` — exported from `train/plan.ts` — is true).
2. `src/minigames/ferrisWheel/exit.ts` — same pattern: `FERRIS_WHEEL_EXIT`,
   a couple of metres to the side of the ferris wheel's entrance, on the
   *opposite* side from the kiosk (`stallPlacement.ts`'s `ferrisKiosk` —
   same maths, negated).
3. `src/world/paths.ts` — `PathNode.kind` gained `'exit'`; `buildGraph()`
   adds a `spur()` node for each of the three exits (reusing `spur`'s
   existing "no past-the-doormat extension" case by passing the exit point
   as its own `towardX/towardZ`).
4. `src/world/dismount.ts` — new universal safety net: `resolveDismount(
   collision, x, z, radius)` — verifies `isClearCircle`, else spiral-searches
   outward in 0.6 m rings to 6 m. Used by:
   - `Coaster.arrive()` (the actual fix — was the raw stall-interior offset)
   - `ParkTrain.alight()` (was already safe — `station.standX/Z` — net added
     for defence in depth, per the "whatever else regresses" brief)
   - `Game.ts`'s new `MiniGameHost.onResult` handler, gated on
     `result.id === 'spaceFerrisWheel'`, since the ferris wheel is a curtain
     mini-game (no `beginRide`/`endRide`) and previously never moved the
     player at all — she stayed at the stall's doormat, which was not
     actually broken but had no exit node and no dismount-helper coverage.
5. `World.ts` — `Coaster` now takes `{ plan, camera, race? }` instead of
   solving its own route; `CoasterOptions.avoid/routeSalt/stationStallId/
   bandMin/bandMax/nominal` all removed (they live in the plan now).
6. `GAME_DESIGN.md` — EXIT rule added under the absolute rules, after
   CONTROL.

## NOT changed, deliberately (budget call)
NPCs riding the train (`entities/npc/activities/trainTrip.ts`) leave their
seat and `rejoinGraph` with no explicit coordinate write — they end up
wherever `ParkTrain.carryPassengers` last placed them, which (train stopped
at a platform) is already safe ground, not the reported bug, and wiring
`CollisionWorld` through `DriverContext`/`ActivityHost` to route it through
`resolveDismount` too is a bigger plumbing change than this single-pass
budget allows. No NPCs ride the coasters at all (`Coaster.arrive()` is
player-only — confirmed, grepped `src/entities/npc/` for `Coaster`, zero
hits).

## Remaining before merge (if you're picking this up)
- [ ] `test/procgen/parkFacts.ts` + `invariants.ts`: add `exits` fact (from
  `PATH_GRAPH` nodes of `kind === 'exit'`) and a
  `rideExitsAreClearAndReachable` invariant — clear via `isStandable`,
  reachable via a `NavGrid` built the same way `scripts/check-park.mts`
  builds one (`PLAYER_RADIUS`, `JUMP_APEX_HEIGHT`, `ENTRANCE_PLAYER_X/Z`).
  One line in `INVARIANTS`.
- [ ] `npm run build` (checked exit code, not piped)
- [ ] `npx vitest run`
- [ ] QA in chrome-devtools (I own the browser for this task): Sky Cruiser
  ride + walk away, Rail Race ride + walk away, train ride + alight, ferris
  on/off, screenshot each coaster's dismount moment.
- [ ] `gh pr create`, `gh pr checks --watch` for "Procgen invariants", end
  body with "Verdict: ready for review", do not merge.
