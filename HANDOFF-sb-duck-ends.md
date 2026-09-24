# HANDOFF: sb-duck-ends

Model: Claude Opus 5.5 (the agent that did fix/sb-duck-bars; chosen by the structural-backtrack engineer).
Branch `fix/sb-duck-ends` off `origin/wip/sb-merge` (5a9fc0fd). No PR.

Task: duck bar ends must clear every other lane's track envelope (bed + cart). Invariant in
test/procgen/invariants.ts, refusal at bar-slot choice (reuse DFS + laneShift), red proof on
seed 4 (recorded restart 2), coplanar seed 4, rail-race, tsc x2, park:attempt 4/2/5; re-accept
any seed whose bars move.

## State
- src/world/railRace/barReach.ts: one owner. `laneEnvelope(scale)`, `duckBarPose(route, lane, at)`
  (track.ts now draws bars with it), `duckBarIntrusions(route, lane, matrix)`.
- Baseline (unmodified) in scratchpad sbde/base: 4-2, 2-0, 5-2 all accepted; cop4 has the
  walk-past duck-bars|trestle-branches-upper seam.

## Findings
- Envelope: walk-past halfWidth 0.694, below 0.131, above 1.438 (cart top); race x2.5.
- Seed 4 planned bars: walk-past 16/40 intrude (worst 0.694 m), race 4/40. Bar 37 (lane 2, slot 44)
  is the reported one: lane 3, station 206.2, 0.02 m above lane 3's rail.
- 81 of 196 lane:slot pairs blocked on seed 4 (either ring).
- Rider NOT in envelope (head 2.84 vs bar underside 2.55 at park scale) - would block far more.
- Invariant `every Rail Race duck bar keeps to its own lane` added (facts: duckBarReach). RED on
  4 r2 with no refusal: 21 complaints (sbde/red/4-2.out), e.g. walk-past bar 1 over lane 1 at
  73.28 m reaches 0.536 m into lane 0 at station 340.6 (-0.05 across, 0.90 up).
- duckBarIntrusions now uses one stationOf per bar (76 ms for all 392 lane-slot checks on seed 4).
- Refusal: simulate.ts reachRefusedSlots(len, [walkPast, race]) seeds refusedBarSlots; DFS +
  laneShift unchanged. Comparing layouts over seeds 0..15 (sbde/bars-*.txt) in progress.
