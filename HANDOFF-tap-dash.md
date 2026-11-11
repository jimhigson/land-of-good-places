# HANDOFF — tap to go: long journeys dash (Jim, 11 Nov)

Branch `tap-superspeed`, worktree `.claude/worktrees/tap-superspeed`.

## Design (decided)
- Owner of the curve + constants: `src/entities/tapDash.ts`.
  speed(L) = v for L <= v*1.5 (11.1 m); else v*(1-1.5/4) + L/4. Asymptote 4 s, continuous, monotonic.
- `TapNavigator` judges the journey once at plan (`planDash`), eases the boost to 1 over the last
  v*0.3 = 2.2 m (`dashBoostNow`), and hands it to `Player.setTravelBoost` each frame. Scripted walks never dash.
- `Player`: speed limit = v*max(sprint, boost); accel x boost^2 (same turn arc as a walk);
  boost removed mid-dash clamps velocity to walk (interruption at normal speed). Leg cadence capped at
  `DASH_CADENCE_SPEED`; extra lean/swing via `dashLean`. Dust pool 12->16.
- `Game.stepPlayer`: during a dash the frame is split into strides <= 0.5 m (`dashSubsteps`), each a full
  navigator+Player.update; previousPosition restored to frame start for bandCrossed; `Parade.followStride` per stride.

## Gotcha
Player.ts/TapNavigator/Parade/dustPuff/tapDash are in the park-source-hash closure -> CI re-solves parks
on every push touching them. Local dev: main's parks artifact restamped into .parks (local only).

## Status
- [x] code
- [ ] check:tap-dash (curve, tunnelling on seeds, arrival) + reds
- [ ] full check, test:procgen, PR, CI, preview screenshots + frame sheet
