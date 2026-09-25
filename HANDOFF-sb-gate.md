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
