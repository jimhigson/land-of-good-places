# Handoff — item 1.3, the CONTROL RULE (no tank controls)

**Branch:** `feat/no-tank-controls`
**Worktree:** `.claude/worktrees/no-tank-controls` (the main checkout is shared
with the P0 face-paint agent and the UI-scale agent — do **not** work in it)

## Review round 1 (PR #46) — applied

Rebased onto `origin/main` (`c602bc4`: face-paint P0, both architecture
decisions, the rem/root-scale UI rework and its `check:text` build step) and
force-pushed. The review found nothing structurally wrong; every ask was a
comment or a claim, except one that was settled by making the code true.

1. **`screenBasis.ts` asserted a false invariant.** It said no camera in the
   game rotates, so a basis could be solved at construction and read for ever.
   `WaterFight.resize` swings its yaw 45°→88° between landscape and portrait.
   Reworded: a basis belongs to a *yaw*, not a scene — cache only where the yaw
   is provably constant (the park, the rink), re-derive on any camera or
   viewport change. `WaterFight.applyCamera` says why it re-solves.
2. **The analogue-magnitude claim is now delivered**, not dropped.
   `driveCars` splits the ask into a direction and a strength; rivals still
   normalise (their length is metres), the player's length scales the push.
   `GENTLEST_PUSH = 0.4` floors it, which is what handles `going = hold ||
   wants` — a thumb resting just past the dead-zone potters at ~2.2 m/s rather
   than stalling at ~2% thrust. Keys and the d-pad hand in a full-length
   direction, so they are unaffected and still get everything.
3. **`TURN_RATE`'s doc** no longer claims zero would change nothing (the
   go-with-no-direction branch would drive the spawn heading for ever).
4. **The lean re-tune is now flagged, not buried.** `car.turn` changed units
   (radians of drift → fraction of max slew) under the same `0.34`, so the
   gentle cases lean ~3x deeper. Kept deliberately; said plainly in
   `Dodgems.animate`, in `car.ts` at the multiplier, and in the PR's QA list.

Open for QA (no browser this session): the lean depth, and whether the longer
HUD steering hint wraps or clips on a narrow phone.

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
- Dodgems: a gentle thumb/stick push gives a gentle drive; keys still give full.
- Dodgems: the model leans into a change of direction and rocks after a bump —
  **deliberately about 3x deeper than before**; ask the family if it is too far
  (lower the `0.34` in `car.ts`).
- Dodgems: the steering hint does not wrap or clip on a narrow phone.
- Ferris wheel look-around: unchanged.
- Park walking, and walking inside the castle interior (600 m away): "up" still
  means the same screen direction in both.
- Tree climbing: peek holds still; pressing a direction climbs down.
