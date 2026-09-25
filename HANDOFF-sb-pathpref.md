# HANDOFF — sb-pathpref (fix/sb-pathpref, base origin/wip/sb-merge)

Model: Claude Opus 5.5 (chosen by the structural-backtrack engineer). A replacement runs the same model.
Worktree: .claude/worktrees/sb-pathpref. Scratch: $SCRATCH/sb-pathpref/ (session scratchpad).

## Task
`LGP_SEED=0 pnpm run check:path-preference` red: kerb hop worst 80.4% (kerb -> (11,-7) 2.7 m off), ceiling 73%.
Root-cause, decide router/geometry bug vs placement decision, make all 16 seeds exit 0, prove red.

## Findings
- Reproduced at 3ba8359c: seed 0 (restart 2) exit 1, only failure is the kerb hop.
- Diagnostic (scripts/_diag-pathpref.mts, untracked): hop from centreline (11.35,-3.01) to (11,-7).
  A hoppable stone wall (lawn bench, flush on the kerb) stands between: hop band x 6.5..13.5, z -4.5..-6.0
  (4 cells = 2 m deep). Unweighted route hops straight: 4.45 m. Weighted route walks east along paving round
  the band's end (13.97,-5.18): 8.02 m. Both end at (10.47,-7.18), reached=false (goal cell next to a collider).
- Band cells are unpaved, so weighted cost per band cell = HOP 2.65 x OFF_PATH 1.6 = 4.24; knife edge:
  weighted straight ~22 vs round ~20 (cells); unweighted straight ~14.6 vs round ~14.8.
