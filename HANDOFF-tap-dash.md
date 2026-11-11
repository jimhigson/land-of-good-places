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

## Review + QA round (11 Nov, later)
- Camera: `IsoCamera.cameraLead(speed, dt)` (frame-exact lead above a sprint) + stride-by-stride follow along
  `Player.framePath`. 250 m+ dashes at 390x844 drift <= 0.18 NDC (red with old lead: 1.05).
- Doors: `framePath.ts` + `tapSpacing.bandWalkedThrough` (Hotel/Library/ReptileHouse). Contract clause red under
  deleting the previousPosition restore.
- Pose + marker once per frame; resolveMovement result reused; Player callbacks bound once; trail ring buffer.
- Pets: `followPace = (sprint/pace)^2` past a sprint -> 3.7 m at arrival (red at followPace=1: 52-163 m).
- Hitch: FrameStrides clamps a dash's movement on a frame > 1.25x typical (red: 5.4-6.7 m jump).
- Interior: two hotel-lobby journeys. Runs reset between journeys. Tunnel sweep honours solidStepCeiling.
- Local gate on e0d3b177: check 0, test:procgen 0 (2168), build 0.
- TODO: CI green, phone frame sheet of a 250 m+ dash on the newest preview (seed 0, start ~65.7,43.4).
