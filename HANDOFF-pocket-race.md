# HANDOFF pocket-race (fix/pocket-race, base origin/feat/procgen-on-sphere c190ba58)

Tasks: A seed 128 doormat/bridge reachability; B seed 3 race camera reversal; C seed 6 duck bar at 379.34 m.
Temp seed tests: test/procgen/seed-tmp{3,6,128}.test.ts (never commit). Logs in scratchpad/pocket-race/.

## Base reds on 3/6/128 (vitest, base c190ba58): 8 failed | 292 passed
- 128: doormat (anchor:dodgems 50.6,19.5; stall:dodgems 81.9,41.7; stall:facePaint 27.1,39.2), bridge deck (43.5,49.4) unreachable, coping stone (not mine)
- 6: duck bar 379.34 m 3.40 in/out; rainbow legs near path (not mine); coping (not mine)
- 3: camera -0.067 @334 m speed 0, 40/4800; sleepers 0.260 m (not mine; maybe #702)

## Findings
