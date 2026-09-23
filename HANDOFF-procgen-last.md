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

## 5. Fairy poles (knock-on, found by check:coplanar) — FIXED in FairyLights.ts

My path changes moved seed 208's fairy poles and `check:coplanar` gained one
NEW finding (two knobs z-fighting). Root cause pre-exists in the base: the
claims registry never refuses a feature for its own claims, so poles of two
runs overlapped (base s208: 0.087/0.204/0.291 m pairs; head had 0.032 m).
Fix: `FAIRY_POLE_SPACING` = 2*POLE_RADIUS + 2*PLAYER_RADIUS, refused in
`chooseSpot` (slides along run). That exposed a second base bug: poles on a
bridge deck (isOnPath cannot see bridge paving) — seed 11 fairy-pole-88 on the
(1.5,-31.6) walkway broke `every railway crossing has a bridge you can walk…`.
Fix: `pointStandsOnABridgeRamp(x, z, POLE_RADIUS)` refusal. New invariant
`fairyPolesStandWalkablyApart` (spacing + built-bridge covers); both clauses
proved red with the refusals disabled (s131/canonical 0.699 m pairs;
s11 fairy-pole-88 on bridge at (2.8,-20.2)).

## Results so far
- test:procgen head3: `1 failed | 702 passed (703)` (5 new fairy tests), 0
  skipped; name diff vs base = exactly the four removed, bushes identical.
- check:park 0..15 round 1 (before fairy fix): all green; waypoints differ only
  s3 240->239, s6 241->238 = `stall.railRacer-exit-railRace` connector refused
  by the arch-feet screen (s6 base ran it 0.12 m from a foot; s3 3.10 m ctl).
- Pre-existing, not fixed, report: s6 `spur-exit-railRace` runs 0.08 m from a
  race-ring foot (spur, not connector; s6 not a test:procgen seed).
- digests agree across two processes for 11/131/326.
- swept-bus OK, entrance-road OK (round 1). Base coplanar is itself red
  (2 MORE, 6 NEW, 2 WORSE); head differed only by the fairy knob finding.

## Status
- running: round 2 (check:park 0..15, coplanar, swept, entrance, digests) after fairy fix
- then: before/after plot of s131 ferris pocket (`scripts/_probe-plot.mts`,
  untracked; before = scratchpad s131.svg.png), PR against feat/procgen-on-sphere
