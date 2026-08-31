# HANDOFF — check:speech-bubbles red on main

Branch `fix/bubble-offscreen`, worktree `.claude/worktrees/bubble-offscreen`.

## Root cause (measured, not reasoned)

**The check drove the frame in the wrong order. The game is correct.**

`Game.tick` (`src/Game.ts`): input (1444) → player (1539) → **camera (1597)** →
**world (1615)** → systems → hud → render. Nothing between `world.update` and
`render` touches the `IsoCamera` (`camera.update` is called in exactly one
place in `src/`), and `render` draws with `this.camera.camera` unchanged.

Every speech bubble is gated and sized from **inside** `world.update`:
`NpcSystem.updateBubbles` (NpcSystem.ts:1427), `Hotel` (2154), `WildPets`
(350). So in the running game the camera a bubble's `isOnScreen` gate is
evaluated against **is** the camera that then renders it, same frame. No lag.

`scripts/check-speech-bubbles.mts` stepped `world.update` **first** and let
`camera.update` follow — while its own comment claimed that was "exactly
`Game`'s order". That invented a one-frame camera lag the game does not have.

Probe (temporary, deleted): recorded what `updateScreenSize` saw at draw time
vs what the assertion saw at test time, frames 4404–4410, for Wren.

```
frame 4408 Wren
  draw time: anchor screen-right = -5.498, camera.right = 5.500  -> ON  screen (2 mm inside)
  test time: anchor screen-right = -5.533                        -> OFF screen (33 mm outside)
  camera moved 35 mm of screen-right between world.update and camera.update
```

#423 (walls alongside paths) moved the walls and therefore the paths, so the
children walk different routes (1563 → 986 sightings) and one route grazed
Wren's anchor along the frustum edge while the camera was panning. Nothing was
ever drawn in the wrong place; the measurement was taken from a camera state
the frame was never drawn with.

## Fix

One change: swap the two lines in the check's frame loop so `camera.update`
precedes `world.update`, matching `Game.tick`. Doc header and call-site comment
record why the order is load-bearing.

No source change. The assertion is untouched, unwidened, and not special-cased.

## Numbers

| | sightings | breaches | exit |
|---|---|---|---|
| before (origin/main dd5a1b09) | 986 | 1 off-screen | 1 |
| after | 985 | 0 | 0 |

Still armed (re-proved on this branch, default seed, 390x844, SECONDS=120):

- `--mutate`: 1437 sightings, 452 off-screen speakers (worst 37.63 m), 9068
  set-once drifts (worst 9.22 m) — exit 1.
- `--mutate-anchor`: 985 sightings, 7349 set-once drifts (worst 9.22 m) — exit 1.

## State

- Fix committed and pushed.
- `pnpm run check` / `build` / `test:procgen` — see PR.
