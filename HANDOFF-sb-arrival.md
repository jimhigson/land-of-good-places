# HANDOFF sb-arrival (model: Claude Opus 5.5, chosen by the structural-backtrack engineer)

Task: `LGP_SEED=0 pnpm run check:cat-bus` failed "child 0 at x -4.63, z 57.00 crossed the boundary outside the gate opening". Make all 16 seeds pass.

## Root cause (measured)
- Child 0 had no nudge; she went under the arch at x -3.06 on the gate line z=60 (between the piers).
- On seed 0 the boundary spline crosses the gate slanted ~35 deg: wall stops at (5.85,64.13) and (-5.78,56.36). Edge radius at x=-3 is 58.15, not 60.
- So she reached the spline only at (-4.63,57.20): across 4.63 > the 4.3 strip the check used, but 0.97 m clear of the nearest wall collider. The check's strip was a proxy for "the gap in the wall".
- Secondary real bug: the fan aimed the outermost child at +/-3.0 (+/-0.2 wobble) against a 3.50 m pier face; with NPC_RADIUS 0.5 she clipped the west pier by 0.06 m (scripted walks ignore collision).

## Fix (current)
- ArrivalSequence: GATE_FAN_HALF_WIDTH = GATE_ARCH_CLEAR_WIDTH/2 - NPC_RADIUS - wobble (2.80).
- ArrivalSequence.planAround(collision) (called in attachNpcs, finished world): each route to its release point must fit at NPC_RADIUS; else backtrack aim inward (0.05 x20) then finish x toward axis (1 m x12); else release at last clear point. Entrance passes collision.
- check-cat-bus clause 6: (a) scripted on-foot child never overlaps anything solid (isClearCircle NPC_RADIUS, every frame); (b) gate-line crossing |across| <= clear/2 - NPC_RADIUS; children let go before the gate are announced on stderr (seed 0: child 10 let go 1.36 m short by finish()).
- Found by the broader clause: seeds 6/11/12 child 0 clipped the west pier by 0.01 m; seed 6 children 0-2 brushed lineside fence (half 0.18) 8 m in.

## Side finding (not fixed; visible geometry)
Wall-to-pier gaps beside the arch (clear, after pier keep-out 0.8 and wall half 0.45), east;west:
0: 3.16;2.68  2: 1.53;1.20  3: -0.25;1.29  7: 1.20;1.39  10: 0.35;1.93  15: 1.29;0.45. Cause: wall aperture is a gate-frame strip while the spline crosses the gate slanted (35 deg on seed 0).

## Status
- seed 0, 6 pass on 3rd design. Full 16-seed sweep next, then red proof, then seed5 Collision merge test.
