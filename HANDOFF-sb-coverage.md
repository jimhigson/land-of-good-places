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

## Costs (seed 5 r0, CPU)
- Lead wants cost down (seed 15 needs 8-9 attempts in build:parks).
- path-preference decisions-only 6.9 s (was ~60). Sims in-process on fresh World (6.5 s build):
  cat-bus 13.7, npc-dispersal 37.0, stall-accommodate 8.2, slide-rider (trackside only) 43.6,
  pet-slide (wired only) 47.4. Only check:rail-race still a subprocess.
- Fidelity fix: lib/freshWorld.mts restores plan claims before every fresh World (digest-proved).
- Batch 4 reported to lead. Verification attempt with restore: see scratchpad attempt5e.

## Next
- Full attempt seed 5 for before/after; report to lead; consider profiling pet-slide/slide-rider further.
- Verify scripts unscoped still pass (cat-bus, npc-dispersal, slide-rider, pet-slide, path-preference, hotel).
- Never run a script without LGP_PARK_RESTART: resolver triggers a whole acceptance loop.
