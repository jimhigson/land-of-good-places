# HANDOFF — slide search cost (fix/sb-slidecost)

Model: Claude Opus 5.5 (1M), Engineer helper chosen by the #706 (structural-backtrack) agent. A replacement runs the same model.
Base: origin/feat/structural-backtrack @ 215fa58c. Worktree: .claude/worktrees/sb-slidecost.

Task: seed 11 r4 plan solve is 830 s wall, slide 677 s / 352 M pieces over 20 slide turns. Find why, cut at cause,
prove decision trace identical (parkSolveTrace) on 11r4 and 12r0.

Probe: scripts/slide-cost-probe.mts (LGP_SEED, LGP_PARK_RESTART, LGP_SLIDE_LOG=1 per-turn log, LGP_TRACE_OUT=file).

## Findings
- Slide route search reads only layout + cruiser (+ PARK_SEED, boundary). The train is read only in planExit
  (finishSlideSearch), yet slide deps include train, so every train redraw re-runs the identical route search.
