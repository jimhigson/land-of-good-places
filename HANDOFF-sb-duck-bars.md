# HANDOFF: sb-duck-bars

Model: Claude Opus 5.5 (chosen by the structural-backtrack engineer). Branch `fix/sb-duck-bars` off `origin/wip/sb-merge`. No PR.

Task: make "every Rail Race duck bar slows you down where it stands" a refusal at the
point of decision — bar slots where the flat-out never-ducking rider arrives at
MIN_SPEED are refused and the bar moved; no slot -> throw so the root loop restarts.

## Status
- DONE. after2: duck-bar measure gone on 0r0, 3r1,r2,r4,r5, 4, 6, 12, 14; nothing newly failing on any of 12 parks.
  Red proof (refusal disabled): 6r0 and 3r1 fail the duck-bar measure again (379.34 / 379.27 m). check:rail-race 0, tsc 0.
- Baseline park:attempt runs going in a detached worktree `.claude/worktrees/sb-duck-bars-base`
  (outputs in the agent scratchpad `base/`).

## Findings
- Root cause (seed 0 r0, ring 599.93 m, player lane 3): bar planned at 379.55 sits inside
  black stretch 361.1-380.7. Flat-out rider bonked to 9.80 at 355.06, then sparks (no thrust,
  +6 m/s^2 drag) and is at MIN_SPEED 3.40 by ~370 m; bonk max(3.4, 0.35*3.4) = 3.40.
  Lane 1 has the same defect at 489.74 (zone 476.1-498.4).
- Live game uses the same stepRider + scheduleForLevel + raceRing (RailRace.ts:821), so the
  invariant describes real physics.
- "clear of spark zones" is NOT an existing rule: Jim allowed bars over black rail (hazards.ts
  BAR_LANE_OFFSETS). Refusal only rejects floor-clipped slots.
- Fix: simulate.ts refusedBarSlots(route) races every lane, whole race, flat-out never-ducking;
  a crossing where speedIn*BONK_SPEED_FACTOR <= MIN_SPEED refuses (lane, slot); re-plan until
  clean. planHazards takes refusedByLane; snapToTrestleGrid throws DuckBarRefusal instead of the
  old silent raw-slot fallback.
- Canonical 20260728: lane1 492.13 -> 564.15, lane2 564.15 -> 420.11; all other 38 bars unchanged.
- check:rail-race exit 0 after the fix. tsc exit 0.
- First cut (greedy outward walk) made seeds 14 r0 and 3 r4 throw DuckBarRefusal: 40 bars in 42-43
  window slots, a moved bar took the last slot a later bar needed. Fixed: planHazards pass two is a
  DFS in the same nearest-first order (identical layout when greedy works), budget 200k; plus a
  laneShift fallback decision in simulate.ts barPlanDecision. Both seeds now settle at shift 0.
