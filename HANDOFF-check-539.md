# HANDOFF — issue #539: arm `check:hop-clearance`

Branch `fix/check-539`, worktree `.claude/worktrees/check-539`, based on `main` @ `807445af`.

## The finding, re-verified myself (not taken on trust)

- `scripts/measure-hop-clearance.mts`: `grep -c "process.exit\|exitCode\|throw "` = **0**. Confirmed.
- It is **step 6 of 61** in the required `check` chain (parsed from `package.json`, not grepped).
- Baseline run: **exit 0**, ~**1 s**, prints
  `Worst clean crossing over the park's own wall thicknesses: 1.045 m`
  against `MAX_AUTO_HOP_HEIGHT = 1.00` — the 45 mm margin the issue names, enforced by nothing.
- Cost is ~1 s, so arming it spends no meaningful CI margin (cf. #530).

## Geometry the measurement rests on (paste this with any red-run transcript)

`PLAYER_RADIUS = 0.62` (`src/core/constants.ts:112`);
`JUMP_SPEED = 6.6`, `GRAVITY = 17` (`scripts/playerSim.mts:55-56`) → `JUMP_APEX_HEIGHT = 1.2812`;
`MEASURED_HOP_APEX = 1.2812`, `MAX_AUTO_HOP_HEIGHT = 1.0`,
`measuredHopCeiling(c) = 1.574 - 0.3c` (`src/world/Collision.ts:197,206,224`).

Sweep: halfThickness {0.15,0.22,0.28,0.34,0.45,0.6} x fps {20,30,60,90,120} x {walk,sprint} x
angle {0,20,40} = **180 rows**, 30 per thickness (verified by row count).

Per-thickness minimum of the `clean` column on `main` @ `807445af`, vs the fitted line
(`crossing = 2*(half + PLAYER_RADIUS)`):

```
half=0.15 crossing=1.54 measuredMin=1.112 fittedCeiling=1.112 margin=+0.0000
half=0.22 crossing=1.68 measuredMin=1.100 fittedCeiling=1.070 margin=+0.0300
half=0.28 crossing=1.80 measuredMin=1.045 fittedCeiling=1.034 margin=+0.0110
half=0.34 crossing=1.92 measuredMin=1.045 fittedCeiling=0.998 margin=+0.0470
half=0.45 crossing=2.14 measuredMin=0.975 fittedCeiling=0.932 margin=+0.0430
half=0.60 crossing=2.44 measuredMin=0.879 fittedCeiling=0.842 margin=+0.0370
```

Controls run on that instrument (an earlier awk gave `0.000` everywhere — auto-created array
element — and was caught only by the control): independent `sort -n` per thickness agrees at both
ends (0.15 -> 1.112, 0.60 -> 0.879), and the three worked examples in `measuredHopCeiling`'s own
docstring (1.54/1.112, 1.92/1.045, 2.44/0.879) reproduce exactly.

**The margin at half=0.15 is exactly zero — the fitted line touches the measurement.** So the
lower-bound assertion must be non-strict (`ceiling <= measured`); any added safety margin would
fail today's park for a number nobody can justify.

## What is being asserted, and why each threshold comes from the game

A. every measured cell is finite — `highest()` returns `NaN` on failure and `Math.min(x, NaN)` is
   `NaN` silently (the issue's point).
B. `|JUMP_APEX_HEIGHT - MEASURED_HOP_APEX| <= 0.001` — tolerance copied from the game's own boot
   check `checkHoppableColliders` (`Collision.ts:1093`), not invented.
C. `measuredHopCeiling(crossing) <= measured clean` at every swept point — this is the docstring's
   own claim ("a straight line fitted *underneath* every measured point... a lower bound on the
   truth everywhere") and it is the **correctness precondition of the boot check**: if the fitted
   line ever rises above the truth, `checkHoppableColliders` passes a wall that in fact strands her.
   Currently that claim is a comment, i.e. two definitions kept in step by hand.
D. `MAX_AUTO_HOP_HEIGHT <= worstClean` over the thicknesses the park really uses.

## Open question being resolved

`worstClean` is computed only over rows with `halfThickness >= 0.2 && halfThickness <= 0.4`, a
hard-coded window the script *calls* "the park's own wall thicknesses". Rows at 0.60 read as low as
**0.879**, below the 1.00 m ceiling. A subagent is enumerating real `addWall` half-thicknesses to
say whether that window is faithful. If the park builds hoppable walls fatter than 0.4, D is a
genuine red and gets reported, not weakened.

## Status

- [x] finding re-verified, baseline captured, geometry recorded
- [] assertions implemented
- [ ] proved red (mutation asserted to have landed), transcript + geometry pasted
- [ ] `check`, `test:procgen`, `check:coplanar`, `build` green, exit codes read unpiped
- [ ] PR opened
