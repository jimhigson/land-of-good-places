# HANDOFF: sb-sleepers

- Model: Claude Opus 5.5, chosen by the structural-backtrack engineer.
- Branch: fix/sb-sleepers, based on origin/feat/structural-backtrack (e5d8c8ec). No PR (caller's instruction).
- Task: make `railRaceSleepersBridgeBothRails` pass on seeds 1, 3, 8, 9 (+ canonical 20260728) by porting PR #702's two commits (a35d3690, 203f6b5d) and root-causing anything left.

## State
- Cherry-picked both commits cleanly; patch text identical to the originals.
- Baseline (before) park:attempt runs: worktree .claude/worktrees/sb-sleepers-base at e5d8c8ec (remove when done).
