# HANDOFF: sb-sleepers

- Model: Claude Opus 5.5, chosen by the structural-backtrack engineer.
- Branch: fix/sb-sleepers, based on origin/feat/structural-backtrack (e5d8c8ec). No PR (caller's instruction).
- Task: make `railRaceSleepersBridgeBothRails` pass on seeds 1, 3, 8, 9 (+ canonical 20260728) by porting PR #702's two commits (a35d3690, 203f6b5d) and root-causing anything left.

## State
- Cherry-picked both commits cleanly; patch text identical to the originals.
- Baseline (before) park:attempt runs: worktree .claude/worktrees/sb-sleepers-base at e5d8c8ec (remove when done).

## Finding (root cause of what the port did NOT fix)
- On seeds 1,3,8,9 the failing clause is the SPACING one, not the bridging one:
  e.g. seed 3 race ring lane 0 s=37 m: sleeper step 1.254 m (chart horizontal 1.233 = 1 + 4.125/17.7 m bend; lean adds ~1.6%).
  Cause: sleepers laid at i*1 m of CENTRE-LINE distance; a lane offset d gets 1 + d/R per sleeper. Bends on these seeds are 17.7 m, not the invariant's assumed 20.
- Fix (commit dff9c23e): `stationsEvenlyAlongDrawn` in rail/sweptRail.ts (one owner); track.ts lays sleepers there; check:tie-frame asks it too. Invariant tolerance untouched (comment updated).
- Baseline logs: scratchpad before-<seed>.log. Canonical baseline passes all 101 measures.
