# HANDOFF sb-arrival (model: Claude Opus 5.5, chosen by the structural-backtrack engineer)

Task: `LGP_SEED=0 pnpm run check:cat-bus` failed "child 0 at x -4.63, z 57.00 crossed the boundary outside the gate opening". Make all 16 seeds pass.

## Root cause (measured)
- Child 0 had no nudge; she went under the arch at x -3.06 on the gate line z=60 (between the piers).
- On seed 0 the boundary spline crosses the gate slanted ~35 deg: wall stops at (5.85,64.13) and (-5.78,56.36). Edge radius at x=-3 is 58.15, not 60.
- So she reached the spline only at (-4.63,57.20): across 4.63 > the 4.3 strip the check used, but 0.97 m clear of the nearest wall collider. The check's strip was a proxy for "the gap in the wall".
- Secondary real bug: the fan aimed the outermost child at +/-3.0 (+/-0.2 wobble) against a 3.50 m pier face; with NPC_RADIUS 0.5 she clipped the west pier by 0.06 m (scripted walks ignore collision).

## Fix
- ArrivalSequence: GATE_FAN_HALF_WIDTH = GATE_ARCH_CLEAR_WIDTH/2 - NPC_RADIUS - wobble (2.80).
- check-cat-bus clause 6: (a) at first park-edge entry the child must be clear of every collider (NPC_RADIUS); (b) each child must cross the gate line with |across| <= clear/2 - NPC_RADIUS (3.00).

## Side finding (not fixed; visible geometry)
Wall-to-pier gaps beside the arch (clear, after pier keep-out 0.8 and wall half 0.45), seeds 0..15 (east;west):
0: 3.16;2.68  2: 1.53;1.20  3: -0.25;1.29  7: 1.20;1.39  10: 0.35;1.93  15: 1.29;0.45 ... (probe scripts/tmp-sb/probe-gap.mts, not committed)

## Status
