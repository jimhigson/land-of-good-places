# HANDOFF — slide search cost (fix/sb-slidecost)

Model: Claude Opus 5.5 (1M), Engineer helper chosen by the #706 (structural-backtrack) agent. A replacement runs the same model.
Base: origin/feat/structural-backtrack @ 215fa58c. Worktree: .claude/worktrees/sb-slidecost.

Task: seed 11 r4 plan solve is 830 s wall, slide 677 s / 352 M pieces over 20 slide turns. Find why, cut at cause,
prove decision trace identical (parkSolveTrace) on 11r4 and 12r0.

Probe: scripts/slide-cost-probe.mts (LGP_SEED, LGP_PARK_RESTART, LGP_SLIDE_LOG=1 per-turn log, LGP_TRACE_OUT=file).

## Findings
- Slide route search reads only layout + cruiser (+ PARK_SEED, boundary). The train is read only in planExit
  (finishSlideSearch), yet slide deps include train, so every train redraw re-runs the identical route search.
- MEASURED (11r4 base, $SCRATCH/sc/base-11r4.log): 11 slide solves. ONE turn (layout attempt 3, cruiser 0, train 0)
  is 350.0 M of 352.3 M pieces and 651 s of 655 s; it places (73.81 m). The repeats under train redraws are real
  (identical pieces) but cost ~1 s total. So the cause is inside one slideRouteSearch: rungs (door x length) run in
  full. Memo (layout/cruiser object identity -> per-attempt route/refusal; finish re-run) written, uncommitted.
- Next: RUNGLOG per rung (door, length, pieces, report) in $SCRATCH/sc/memo-11r4.log.
