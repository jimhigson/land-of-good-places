# HANDOFF sb-bush

Model: Claude Opus 5.5 (chosen by the structural-backtrack engineer).
Branch fix/sb-bush (from origin/wip/sb-merge), worktree .claude/worktrees/sb-bush. No PR.

Task: decide whether bush-floor (`facts.bushes.length > 180`, theParkIsFurnished)
shortfalls are lack of space or a placement bug; if space, lower floor to measured
honest number with evidence; keep anti-vacuity (prove red by halving budget).
Do NOT raise BUSH_BUDGET.

## Findings
(none yet)
- Committed: plantableRefusal (isPlantable's reason), bush refusalAt, bushScatterLedger,
  `pnpm run -s measure:bush-space` (LGP_SEED, LGP_PARK_RESTART) -> one `bush-space:` json line.
- park:attempt ~400 s wall per park; measure:bush-space ~80 s-6 min (machine loaded).
- Early result: clumps never refuse each other, so planted ~= 4200 * legal fraction.
  planted/legalM2 = 0.21-0.23 on seeds 0-5 (s0 393/1855, s1 311/1423, s2 555/2434,
  s3 555/2296, s4 504/1960, s5 461/2131). Park ~21140 m2. Refusals are paving, plot,
  rail, tree (all by-design clearances). Looks like space, not a bug.
- Raw results: scratchpad/sb-bush/recorded.txt
