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
- Rung analysis (layout 3, door 9.5 len 60): 859 pairings, 722 hit the 1200-step limit, 121 dead-end, 16 solve and fail
  3D cruiser air by 0.19 m. Door 9.5 offers all head east (pit is 36 m west). Cruiser rings the pit rim (5-7 m from
  centre, y~-2) and rises south of the doors. NO exact cheap rung-refusal exists: rungs do solve routes, only the 3D
  check refuses them; and any in-search prune changes the shared rng stream (identity lost).
- Sweep 0..15 r0 (frozen worktree sb-slidecost-frozen @c64c2d4b + log): no slide refusal anywhere; largest placed
  search 7.7 M (seed 10), next 4.5 M, 4.1 M. 11r4's 350 M is the outlier.
- Budget: SLIDE_PIECE_BUDGET = 16 M pieces per slide search (solve.ts), refusal budgetSpent, same consumed blockers.
  Measuring 11r4 with it: $SCRATCH/sc/budget-11r4.log. Open question: slide supply after budget refusal (salts).
- 11r4 with budget, salts kept: 5 salted retries each spent all 16 M at the same decision; cruiser re-draw then placed
  in 18,978 pieces. => e09ba860: budget refusal sets slide supply to attempt+1 (no re-salt), reset in clear().
- 11r4 AFTER (e09ba860): slide 36.9 s / 18.0 M pieces (was 655 s / 352 M); plan wall 307 s cpu 273 s (was 815/764).
  Trace differs only in layout 3's branch (refuse slide -> cruiser 1 -> pathGraph refuses layout 3 at another spot);
  from layout 4 on identical; final ledger identical. Trace-hash digest will change for 11r4.
- Running: $SCRATCH/sc/chain.sh (memo sweep 13-15, base 12r0 in sb-slidecost-base @215fa58c, after-sweep 0..15 r0).
  Worktrees to remove at end: sb-slidecost-frozen, sb-slidecost-base.
