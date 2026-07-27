# Handoff — the lift's call panel (GAME_DESIGN "Riding the lift")

**Branch:** `lift-panel`, from `origin/main` @ 4468183.
**Status:** done, builds clean, PR raised. Needs visual QA only.

## Shape of it

- `src/world/building/liftRide.ts` (**new**) — the whole riding sequence, and
  **Decision 3's seam**: `LiftControl { floors(): FloorInfo[]; go(n): void }`.
  `LiftPanelSource` adds `panelState()` and `call()`, labelled in the file as
  today's glue and expected to die with the car under the floor split.
- `src/ui/LiftPanel.ts` (**new**) — the brushed-metal control plate. Written
  against the seam only.
- `src/world/building/GlassLift.ts` — now dumb machinery: `callTo(floor)`,
  `update(dt)`, `floor`, `moving`. The idle up-and-down cycle and the dwell
  timer are **deleted** (that cycle was the actual bug: the car was always
  somewhere else, moving away).
- `src/core/constants.ts` — `LIFT_SPEED` 2.4 → 7, `LIFT_DWELL` deleted,
  `LIFT_BOARD_SECONDS` added.
- `src/world/building/Building.ts` — owns a `LiftRide`; `callLiftIfWaiting`
  and `riderInLift` deleted; exposes `get liftPanel(): LiftPanelSource`.
  Also: the "everything else" branch of `update` is now gated on
  `!player.riding` as well as `!changingSpace`.
- `src/world/building/layout.ts` — `LIFT_STAND_X` / `LIFT_PICK_X` /
  `LIFT_DOOR_Z` / `LIFT_LOBBY_REACH` moved here from `interactZones.ts` so the
  ride and the tap target share them.
- `src/world/building/interactZones.ts` — the `lift-N` zones are now
  `pressInteract: false`: tapping the lift walks you to the doors, and
  *arriving* is what raises the panel. No more "Ride" action pill competing
  with it.
- `src/Game.ts`, `src/ui/index.ts`, `src/ui/chime.ts` (`playLiftDing`),
  `src/style.css`, `whatsnew.json`.

## Things worth knowing

- **Do not restructure `WalkSurfaces` or the floor model.** Nothing here does.
  The car is still a `MovingPlatform`; `deckAt` still answers inside the shaft
  (`surfaces.ts` already special-cases `LIFT_SHAFT`), which is what
  `lobbyDeck()` relies on.
- Boarding and alighting are scripted `player.beginRide()` +
  `setRidePose` glides, **not** walks — the car is a platform over a
  five-storey shaft and pathing a child into it is the fiddly thing being
  deleted. The glide is a quadratic bent through the doorway, or it clips the
  jamb when she boards from the edge of the lobby.
- A child who walks into a parked car herself is captured into the same
  `aboard` state, so there is one way to be in the lift, not two.
- Getting out = pressing the floor you are already on (it says "Get out
  here!"). That is deliberate: no second control.
- The panel hides when any other overlay owns the screen —
  `uiOwnsTheScreen() && !player.riding`, because riding *is* the lift here.
