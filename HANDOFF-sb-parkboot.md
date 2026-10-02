# HANDOFF sb-parkboot

Model: Claude Opus 5.5 (chosen by the structural-backtrack engineer). Branch fix/sb-parkboot off origin/wip/sb-merge. No PR.

Task: check:park-boot fails on seed 5 with "cruiser was read before it was decided".

## Root cause (found)
- Not an ordering bug. The ParkGeneration loop in the check hits MAX_FRAMES (6000) with the
  driver still at "flying the sky cruiser" — seed 5 unwinds to decision zero twice
  (layout#0: pathGraph leaves park; layout#1: cruiser refuses all 6 attempts "missed the castle"),
  finishing on layout attempt 2. Synchronous solve: 133 s wall on a load-86 box, cruiser 111 s of it.
- The check then pushed the "never finished" foul but carried on to straight-through planSlide(),
  which read the half-driven plan (driver set, solved false) -> misleading throw.

## Done
- Harness: exit with fouls if generation not ready (scripts/check-park-boot.mts).

## Open
- The real foul: seed 5 generation cost. Measuring CPU per feature (scratch drive2.mts).

## Measurements (load ~86 on 14 cores; CPU = threadCpuUsage)
- Seed 5 sliced, uncapped: 12577 frames, ready, 155 s wall, 99.5 s CPU. CPU by feature:
  cruiser 83.9 s, pathGraph 11.2 s (271 pieces, ~41 ms/piece), train 2.7 s, slide 1.2 s.
- Same decision-zero x2 trace at b128937f (pre procgen-on-sphere merge): not a merge regression.
- With harness fix, default seed fails honestly: "never finished: 6000 frames ... flying the sky cruiser".
