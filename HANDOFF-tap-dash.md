# HANDOFF — tap to go: long journeys dash (Jim, 11 Nov)

Branch `tap-superspeed`, worktree `.claude/worktrees/tap-superspeed`.

## Design (decided)
- Owner of the curve + constants: `src/entities/tapDash.ts`.
  speed(L) = v for L <= v*1.5 (11.1 m); else v*(1-1.5/3.5) + L/3.5. Cruise asymptote 3.5 s; door to door
  measured 3.95-4.07 s on the longest real routes (220-282 m) because the brake + walk easing add ~0.5-0.7 s.
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
- [x] check:tap-dash (curve, tunnelling on seeds 5/0/9/13 x dt 1/60,1/30,1/12, arrival vs walk control) green
- [x] reds (logs in scratchpad sup/red1-4.log): CRUISE=5 -> late + cap; BRAKE=0 -> rest 0.73-0.89 m vs walk 0.36, gave up;
      threshold*0.5 -> short journeys not walks; STRIDE=2 -> stride > PLAYER_LONGEST_STEP. Instrument control: straight line
      through park flags 16-38 strides; walk flags 0.
- Note: under the CRUISE=5 mutation seed 0 flagged one airborne stride descending 0.3 m into a 0.44 m non-hoppable wall's
  far edge (escort pushed her on) — existing hop-landing behaviour, not dash-specific; shipping config clean.
- [ ] full check, test:procgen, PR, CI, preview screenshots + frame sheet
