# HANDOFF — paths-to-doors

- Model: Claude Opus 5.5 (1M), chosen by the Overseer. Role: Engineer.
- Branch: `fix/paths-to-doors` off `origin/wip/sb-merge` (PR target: `wip/sb-merge`, lead a52ae9484877226d6, PR #706).
- Worktree: `.claude/worktrees/paths-to-doors`. Logs: scratchpad `paths-to-doors/`.

## Task
1. Invariant: drawn paving (mesh triangles) continuous from gate to every doormat (anchors, stalls, exits, stations), touching the doormat.
2. Invariant: no drawn paving crosses a bridge's parapet/stone except the carried route via the deck ends.
Controls first, sweep 0..15, fix generators, add to PARK_ACCEPTANCE, re-record `accept:parks -- 0-15 --fresh --write`.

## State
- Started. Lead says: fix/sb-bush may touch theParkIsFurnished in invariants.ts (small textual merge expected).
