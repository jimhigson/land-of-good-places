# HANDOFF — sb-lattice (path graph refuses off-grid paving at the point of decision)

Model: Claude Opus 5.5 (chosen by the structural-backtrack engineer). Branch `fix/sb-lattice`
off `origin/wip/sb-merge` @ 3a5199c0. Worktree `.claude/worktrees/sb-lattice`; a detached
baseline worktree `.claude/worktrees/sb-lattice-base` @ 3a5199c0 (remove when done).
Scratch: `$SCRATCH/sb-lattice/` (`sweep.sh <label>`, WT=<worktree> env picks the tree).

## Design
- `src/world/gridAxes.ts` (moved from test/procgen) + `src/world/pavingLegibility.ts`: the one
  owner of `pathsRunOnGridAxes` (`longDiagonals`) and `streetsShareLatticeLines`
  (`offLatticeStreetRuns`) — thresholds and exemptions; the ground is passed in (`PavingGround`).
  Invariants build it from ParkFacts (`builtPavingGround`); pitch stays the invariant's literal.
- `paths.ts` `addInterconnects` refusal(): old `carriesAnOffLatticeStreetRun` + disproportion
  escape replaced by the shared measures on the candidate's drawn curve (no bridges: stricter).
- `parkPlan.ts` pathGraphBuilder: final screen `illegiblePaving` (bridges = conservative
  footprints of the graph's own crossings via `computeCrossings(route, [], drawn)`), refusal
  consumed ['train','layout'].
- `LGP_DISABLE_LEGIBILITY_SCREEN=1` disables both (red proof).

## Status
- tsc both configs 0 after first cut. Baselines running.
