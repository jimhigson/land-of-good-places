# Handoff — the last procgen invariant failures

Branch `fix/procgen-last` off `feat/procgen-on-sphere` (`e982430b`), worktree
`.claude/worktrees/procgen-last`. PR against `feat/procgen-on-sphere`. Model:
Opus 5.5 (1M) — a replacement runs the same.

## Baseline, quoted off the screen (`e982430b`)

`Test Files 3 failed | 20 passed (23)`, `Tests 5 failed | 693 passed (698)`
(the brief said 688 passed; the screen says 693 of 698). Five failures:
bushes s11 (not ours — Jim's call), coping s11 + s131, detour s131, rainbow s326.

## 1+2. Bridge coping (s11, s131) — FIXED, it was the instrument

Not `buildCopingRun`. Probe (`scripts/_probe-coping.mts`, untracked) recovers
each block's placement matrix from its baked vertices and measures its true
base face (authored `y = 0`) at both ends against the cap:

```
bridge-14.0  block 0/81  tilt 50.2deg invariantGap 0.0307 | trueBase low 0.0000 high 0.0000
bridge-14.0  block 40/81 tilt 50.1deg invariantGap 0.0307 | trueBase low 0.0000 high -0.0000
bridge-330.0 block 0/82  tilt 51.5deg invariantGap 0.0316 | trueBase low 0.0001 high 0.0000
bridge-232.0 block 0/98  tilt 47.2deg invariantGap 0.0140 (n=16) | trueBase 0.0000
```

The authored stone has a 2 cm chamfer at its foot: base corner `(y 0, z .385)`,
end-face foot `(y .02, z .401)`. Past ~48° of tilt the end-face foot is lower
than the base, so "the lowest baked vertices" stopped being the base and the
invariant measured the chamfer. The invariant now picks the base face by
authored vertex index and judges **both ends** (stricter than before).

Proved red: lifting the first block of each run 0.03 m in `buildCopingRun`
gives `0.030 m above` on bridge-14.0 (50° block) and on 164/232/330 (shallow
blocks) — seed 11, geometry as at `e982430b`.

## 4. Rainbow s326 — FIXED in `paths.ts` addInterconnects

Culprit (probe `scripts/_probe-rainbow.mts`, untracked): not a spur and not
`pushClearOfRail` — `connector-stall.railRacer-station-1`, `routeLeg` fallback
(no lattice plan), last segment a raw diagonal (28.61,50.49)->(29.62,32.73),
centreline 2.06 m from six race-ring feet. It escaped the off-lattice screen as
disproportionate (19.7 m apart, 73.6 m paved). New screen
`connectorClearsArchFeet` (control polygon + drawn Catmull-Rom vs BLOCKERS'
archFoot radius), no escape. After: no route within 6 m of any foot.

## 3. Detour s131 — FIXED in `paths.ts` addInterconnects

The corridor screen was a red herring: the *lattice plan* for ferrisWheel ->
stall.dodgems was itself 391 m (the grid has no ok nodes between the two plot
footprints), crossing the Sky Cruiser on the far side of the park. So: a lattice
plan longer than `latticeHonestWalk` becomes the *second* decision; the
continuous router (`routeLeg`) is tried first; screens run per decision (now a
`refusal()` closure); backtrack to the lattice plan if the continuous one is
refused. Debug: `LGP_DEBUG_STREETS=1`.

## Status
- commits pushed: coping instrument, arch-feet screen, long-lattice-plan backtrack
- running: full test:procgen (head1)
