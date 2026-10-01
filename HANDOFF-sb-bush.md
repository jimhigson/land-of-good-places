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
- DECISION: space, not a bug. Density .196-.257 clumps/legal m2 on all 16; legal 1320-2759 m2.
  Seed 11 r0 (the only cached bush failure, 175 at an older source) now plants 379.
- DONE: floor now count > 140 AND density > 0.15 per facts.bushLegalM2 (new fact, from
  bushScatterLedger.measureGround grid in Scenery.ts). Proved red at BUSH_BUDGET 2100 on
  11/4, 4/7, 8/4 (reverted).
- NEXT: park:attempt all 16 at recorded restarts -> scratchpad/sb-bush/attempts.txt; then report.
