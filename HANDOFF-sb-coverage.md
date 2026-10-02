# HANDOFF: sb-coverage (helper to #706)

Model: Claude Opus (chosen by #706). Branch `fix/sb-coverage`, base `origin/wip/sb-merge`.
Lead: agent a52ae9484877226d6. Ruling: EVERY decision-judging check is an acceptance measure.

## Done (all pushed)
- pavingLegibility unit test (16/16 mutations red).
- In-process measures in park-attempt ACCEPTANCE_CHECK_MEASURES: entrance-road, swept-bus,
  castle-window, cruiser-turn-radius, coplanar (garden), every-seed-builds (built well + false
  refusal as void), castle-towers (decisions only), path-preference (decisions only), waypoints.
- scripts/lib/checkScope.mts: LGP_CHECK_SCOPE=acceptance -> script fails only on decision clauses,
  exit 3 = void (broken). park-attempt sets it for ACCEPTANCE_CHECK_SCRIPTS.
- Clauses tagged (not yet wired into the loop): npc-dispersal, slide-rider, stall-accommodate,
  cat-bus, hotel, pet-slide.
- Doc: STRUCTURAL-BACKTRACKING.md "Every CI check that judges a park is asked" + "Outside acceptance".

## State
- Registry leak fixed in src (worldPlanClaims + GroundClaims.copy); digests 7d0c5f08 x3, control differs.
  hotel and pet-slide transcripts unchanged on seed 5 after the fix.
- Cost stages (lib/attemptStages.mts + test/attemptStages.test.ts); park-attempt stages 1/2/3.
- stall-accommodate restores the stall-shift table; fresh() rehydrates arrivedByBus before each sim.
- Fixed stale acceptedPark.test expectation (sb-throws message).
- Measuring: seed 15 r0/r1 and seed 5 r0 staged attempts (scratchpad stage-*.txt), then report to lead.
- Never run a script without LGP_PARK_RESTART: resolver triggers a whole acceptance loop.
