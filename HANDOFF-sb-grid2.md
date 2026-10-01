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
