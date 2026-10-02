# HANDOFF — paving-clear

- Model: Claude Opus 5.5 (1M), assigned by the Overseer. Role: Engineer.
- Branch `fix/paving-clear` off `fix/paths-to-doors` 7b0b4003; lead a52ae9484877226d6 merges into wip/sb-merge; NO PR, NO committed acceptedRestarts.ts.
- Worktree: `.claude/worktrees/paths-to-doors` (reused). Scratch: scratchpad `paths-to-doors/`.

## Task
New PARK_ACCEPTANCE measures: (1) no drawn paving under any building/booth solid footprint (owner: colliders), (2) none outside the park boundary. Controls red first; fix generators at cause; restarts per seed; procgen diff+control, check:park 0..15, coplanar, determinism, before/after frames.

## Leads from paths-to-doors probe
- paving under stall booths seed 11 (-41, 29.6); along/outside boundary wall seed 3 z≈60–66; under castle corners (seed 13 (27,-29)).
