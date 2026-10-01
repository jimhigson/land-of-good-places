# HANDOFF: sb-grid2 (model: Claude Opus 5.5, chosen by the structural-backtrack engineer)

Finishing fix/sb-grid's leftovers (grid itself is e2084649, merged in wip/sb-merge).
Probes: scripts/_probe-grid.mts (at rest, GRID=0 control), scripts/_probe-level.mts (mid-race), untracked.

## Status
- [ ] 1. at-rest probe, 16 seeds + control
- [ ] 2. mid-race level fraction per seed
- [ ] 3. check:coplanar exit 0 + revert proof
- [ ] 4. check:rail-race 0,5,9,14; tsc both

## Numbers
Combined probe scripts/_probe-race-contact.mts (untracked; copy in scratchpad sb-grid2/). ~10 min/seed (park build dominates).
- seed 9: REST grid on inside=0 closest 268 mm; grid off inside=12371. MIDRACE (player messy, L3, 5 race seeds, 20 Hz): any-pair 6.6%, player-pair 1.2%.
Loop over remaining seeds logs to scratchpad sb-grid2/contact-<s>.log.

## Task 1+2 results (all 16 seeds, exit 0 each)
```
seed 0 REST grid=on : inside=0 closest=308mm (walk-past lanes 0-1 player=bunches)
seed 0 REST grid=off: inside=5586 closest-when-clear=220mm
seed 0 MID: any 6.5%  player-pair 0.6%
seed 1 REST grid=on : inside=0 closest=213mm (race lanes 0-1 player=bunches)
seed 1 REST grid=off: inside=12540 closest-when-clear=37mm
seed 1 MID: any 5.4%  player-pair 0.9%
seed 2 REST grid=on : inside=0 closest=335mm (walk-past lanes 2-3 player=bob)
seed 2 REST grid=off: inside=36558 closest-when-clear=407mm
seed 2 MID: any 7.6%  player-pair 1.9%
seed 3 REST grid=on : inside=0 closest=479mm (race lanes 0-1 player=bunches)
seed 3 REST grid=off: inside=27097 closest-when-clear=1093mm
seed 3 MID: any 6.1%  player-pair 0.9%
seed 4 REST grid=on : inside=0 closest=290mm (race lanes 0-1 player=bunches)
seed 4 REST grid=off: inside=3993 closest-when-clear=334mm
seed 4 MID: any 7.9%  player-pair 0.8%
seed 5 REST grid=on : inside=0 closest=310mm (race lanes 0-1 player=bunches)
seed 5 REST grid=off: inside=6553 closest-when-clear=73mm
seed 5 MID: any 6.4%  player-pair 0.9%
seed 6 REST grid=on : inside=0 closest=269mm (walk-past lanes 2-3 player=long)
seed 6 REST grid=off: inside=18846 closest-when-clear=247mm
seed 6 MID: any 6.4%  player-pair 1.1%
seed 7 REST grid=on : inside=0 closest=214mm (race lanes 2-3 player=messy)
seed 7 REST grid=off: inside=24574 closest-when-clear=351mm
seed 7 MID: any 7.2%  player-pair 1.7%
seed 8 REST grid=on : inside=0 closest=318mm (race lanes 0-1 player=bunches)
seed 8 REST grid=off: inside=2547 closest-when-clear=1160mm
seed 8 MID: any 9.4%  player-pair 1.7%
seed 9 REST grid=on : inside=0 closest=268mm (walk-past lanes 2-3 player=long)
seed 9 REST grid=off: inside=12371 closest-when-clear=205mm
seed 9 MID: any 6.6%  player-pair 1.2%
seed 10 REST grid=on : inside=0 closest=729mm (race lanes 1-2 player=bunches)
seed 10 REST grid=off: inside=2079 closest-when-clear=257mm
seed 10 MID: any 6.2%  player-pair 1.1%
seed 11 REST grid=on : inside=0 closest=276mm (walk-past lanes 2-3 player=bob)
seed 11 REST grid=off: inside=20818 closest-when-clear=237mm
seed 11 MID: any 6.6%  player-pair 1.2%
seed 12 REST grid=on : inside=0 closest=458mm (walk-past lanes 1-2 player=bunches)
seed 12 REST grid=off: inside=4838 closest-when-clear=689mm
seed 12 MID: any 8.2%  player-pair 1.0%
seed 13 REST grid=on : inside=0 closest=448mm (race lanes 1-2 player=bunches)
seed 13 REST grid=off: inside=1964 closest-when-clear=14mm
seed 13 MID: any 8.2%  player-pair 1.4%
seed 14 REST grid=on : inside=0 closest=216mm (race lanes 1-2 player=bunches)
seed 14 REST grid=off: inside=40017 closest-when-clear=Infinitymm
seed 14 MID: any 5.8%  player-pair 1.2%
seed 15 REST grid=on : inside=0 closest=290mm (race lanes 0-1 player=bunches)
seed 15 REST grid=off: inside=21702 closest-when-clear=Infinitymm
seed 15 MID: any 5.6%  player-pair 1.9%
```
- [x] 1, [x] 2 done. Next: check:coplanar (logs scratchpad sb-grid2/coplanar.log)
- check:coplanar (grid on): exit 1, but hair.shell.crop finding gone (0 mentions). 3 NEW unrelated: facePaintStall cylinder|terrain (seed 2), stone-walls box|terrain (seed 10), fairy-string-59|60 (seed 15).
- Revert proof running: simulate.ts gridSetback temporarily `return 0` (UNCOMMITTED, restore with git checkout src/world/railRace/simulate.ts).
