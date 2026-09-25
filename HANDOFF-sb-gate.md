# HANDOFF sb-gate (model: Claude Opus 5.5, chosen by the structural-backtrack engineer)

Branch fix/sb-gate (from origin/wip/sb-merge), worktree .claude/worktrees/sb-gate. No PR.

## Plan
1. Wall: boundary crosses gate slanted; opening is a gate-frame strip, so wall ends short of piers.
   Fix: cut opening by arc length along the boundary until |across| >= pier centre line, carry
   return walls (drawn + collider) from each wall end to its pier. Invariant theWallClosesOntoTheGate
   (flood fill, collider-only, arch plugged; control = unplugged must get in).
2. Pole: seed 15 fairy pole at (-3.1,59.1) in arch span; gateway path claim is only path-wide.
   Owner isInGateArchSpan in entrance/gateArch.ts; fairyPoleBuilder refuses; invariant
   nothingStandsInTheGateArchSpan.

## Baselines (before, recorded restarts 0:2 2:0 15:0): all accepted, 0 failures, 104 measures.

## Status (commits 0f8772a9 invariants, 12627b93 instrument, 22d44267 fix)
- Red at 12627b93: seed 0 wall leak (5.7,60.0); seed 2 wall leak; seed 15 wall leak (4.7,57.1) + 2 poles in span (3.1,57.8),(-3.1,59.1).
- After 22d44267: seeds 0,2,15 accepted, 0 failures, 106 measures.
- Next: park:attempt remaining 13 seeds; check:cat-bus, gateway, entrance-road (0,15), coplanar, cycle-tdz, tsc.

## Done
- park:attempt all 16 supported seeds at recorded restarts after fix: all accepted, 0 failures, 106 measures. No accept:parks needed.
- check:cycle-tdz 0, check:cat-bus 0, check:coplanar 0 (186 seams, all in baseline), tsc 0, typecheck:test 0.
- check:gateway / check:entrance-road full runs exit 1: pool seed 451 (restart 0) throws DuckBarRefusal in railRace/simulate.ts — reproduced identically on base 63d79421, not this branch. On seeds 0,15 (scratch copies with pool = [0,15]) both exit 0.
