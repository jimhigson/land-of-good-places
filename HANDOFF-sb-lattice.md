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

## Status: DONE (pushed, no PR, per brief)
park:attempt before (3a5199c0) / after, lattice+grid failures only:
- s3 r1: none / none (only duck bar both). s3 r3: grid 29.9 m street-tap-north / accepted
  (builder refused it, unwound to train). s3 r4: none / none.
- s1 r0: lattice connector-hotel-exit-ginormousSlide / gone (bridge tunnel remains, not ours).
- s12 r0: lattice x2 connector / gone. s13 r0: lattice gate-approach / accepted (builder refusal).
- s15 r0: lattice x2 connector / accepted. s10, canonical, s2: accepted / accepted, no measure newly fails.
- detourRatiosStayReasonable and check:park: no new failure on any of the ten.
Red: LGP_DISABLE_LEGIBILITY_SCREEN=1 -> s12 r0 lattice x2 (connector screen), s13 r0 gate-approach (builder).
Final screen measured 7-8 ms, sliced into 4 pieces; check:park-boot passes. tsc both 0; gridAxes.test 6/6.
Open: gate-approach refusal unwinds train,layout; gateApproachSearch could screen its own candidates.
