# Handoff — item 1.3, the CONTROL RULE (no tank controls)

**Branch:** `feat/no-tank-controls`
**Worktree:** `.claude/worktrees/no-tank-controls` (the main checkout is shared
with the P0 face-paint agent and the UI-scale agent — do **not** work in it)
**Status:** complete, built green (`npm run build`, exit 0), PR raised, awaiting
two peer reviews + QA. Nothing left to do unless review asks for it.

## The rule

GAME_DESIGN.md, "CONTROL RULE": press a direction, go that way. Never rotate
towards it. Rotation controls only in first person (ferris wheel look-around;
the first-person train and coaster when they come).

## What was found violating it

1. **Dodgems** (`src/minigames/dodgems/Dodgems.ts`, `driveCars`) — the real
   offender. The stick chose a *target heading*; the car slewed its nose there
   at `TURN_RATE` and thrust along the nose. Source of both family-reported
   bugs (apparent left/right inversion — momentum outliving the nose swing; and
   the "angle clamp" — holding a direction aimed at a fixed compass angle, so
   the car stopped turning once it got there).
2. **Tree climbing peek** (`src/world/TreeClimbing.ts`) — `playerLookYaw +=
   input.moveX * PLAYER_LOOK_SPEED * dt` turned the head by holding a
   direction, in a third-person view. Near-unreachable (any deflection over
   0.22 already meant "climb down"), but it was a rotation control. Removed.

Everything else audited and clean: `Player.ts`, `TapNavigator`, `WaterFight`,
`RailRacer`, `SpookyHouse`, `ParkTrain`, all NPC drivers, `TouchControls`.

## What was done

- **New `src/core/screenBasis.ts`** — the one place that answers "which way is
  up the screen, on the ground", and where the rule is written down. The park
  (`IsoCamera`), the dodgems rink and the water-fight garden all read their
  ground axes from it; they each used to derive the same trigonometry inline.
- **Dodgems rewritten to push, not turn.** All cars (player and rivals — the
  file's "same physics for everybody" invariant is preserved) accelerate along
  the direction asked for. `car.yaw` now *follows* the velocity and is purely
  cosmetic. Speed limiting is measured along the asked-for direction, not as
  raw speed, so a car at full tilt can still change direction instantly.
- **Lean signal moved** from "nose drift vs velocity" (always ~0 now) to "how
  hard the nose is swinging", `car.turn`, -1..1.
- **Gamepad parity**: `applyRadialDeadzone` exported from `InputSystem` and
  reused by the dodgems' own steering, which had its own 0.28 dead-zone and no
  analogue rescaling. One stick, one feel.
- Comments in `ferrisWheel/look.ts` and `SpaceFerrisWheel.aimCamera` now say
  *why* first person is the carve-out, and flag the sign trap (a three.js
  object turns left as yaw increases) that caught an earlier agent.

## Deliberately NOT done

- The ferris wheel's behaviour is untouched (reported correct; first person).
- No change to the framework's one-button `MiniGameInput` contract.

## Needs visual QA (no browser available — P0 agent owns it)

- Dodgems: left/right/up/down each send the car that way on the screen, keys,
  WASD, stick and thumb; diagonals work.
- Dodgems: the car can be driven round and round indefinitely — no clamp.
- Dodgems: model still leans into a change of direction and rocks after a bump.
- Ferris wheel look-around: unchanged.
- Park walking, and walking inside the castle interior (600 m away): "up" still
  means the same screen direction in both.
- Tree climbing: peek holds still; pressing a direction climbs down.
