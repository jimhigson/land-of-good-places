# Rail Race: per-zone sparking + bonk message

Branch `fix/rail-race-spark-bonk`, rebased cleanly onto `main` (which now
includes PR #144's tie-frame fix — no conflicts).

## Status: done, PR open, addressed review round 1

Three bugs fixed now (a third turned up in review — see below). `npm run
build` exits 0 (checked properly, not piped through `tail`),
`npm run check:rail-race` passes. Each commit builds clean on its own.

## Bug 1 — sparks lit the whole ring

Root cause was exactly as diagnosed: `track.ts`'s `setSparking` set one
shared `MeshBasicMaterial.color` for the entire combined spark-ribbon mesh.

Fix: `buildSparkRibbons` now returns `{ geometry, segments }`, where each
`segment` records the vertex range (`vertexStart`/`vertexCount`) one
zone×lane occupies in the combined buffer. The mesh got a per-vertex `color`
`BufferAttribute` (material switched to `vertexColors: true`, still one draw
call). `setSparking(active: readonly SparkingSegment[], elapsed)` resets
every vertex to ink each frame, then paints only the active zone×lane
ranges with the flash colour.

`RailRace.ts`'s `animate()` builds the `active` list from
`cart.rider.zoneCursor % HAZARDS.lap.zones.length` — the same cursor
`stepRider` already advances to decide `rider.sparking`, so it's read off
the physics rather than re-derived from position.

Verified headlessly (not committed — was a throwaway script run via
`scripts/tmp-verify-spark-zones.mts`, deleted after): lighting zone 0/lane 3
alone and zone 1/lane 0 alone each change disjoint sets of vertices, and
lighting both together sums exactly to the two alone (107.1452 vs expected
107.1452) — proving no overlap and no ring-wide leakage. `check:rail-race`
has no existing harness that touches `track.ts` (it only exercises
`route.ts`/`simulate.ts`/`camera.ts`), so this ad hoc script was the way to
prove it rather than trust-and-hope.

## Bug 2 — no bonk message

Added `{ kind: 'bonk' }` to `RaceMoment`, raised in `RailRace.ts`'s
`driveRiders()` only for `cart.isPlayer && events.bonked` (never a rival's
bonk — matches the brief). `RaceHud.ts` got a new `.racehud-bonk` pill,
self-clearing via its own CSS animation (`flashBonk()` just retriggers it,
same off/reflow/on idiom as `setCount`). Text: "Whoops — duck a little
sooner!" — 30 characters, 1 sentence (checked with a one-off `node -e`,
well inside the 50-char/1-sentence brevity rule, though `RaceHud.ts` isn't
one of the files `check:brevity` scans — same as the existing win/lose
banner copy).

## Bug 3 (found in review) — geometry was ~17m from where the physics puts it

**Correction to an earlier note in this file.** The first pass of this
handoff talked itself out of a real bug here with wrong reasoning — worth
recording exactly how it went wrong, since the mistake is an easy one to
repeat.

`track.ts`'s duck-bar and spark-zone geometry was built at raw route
distance `bar.at`/`zone.from` directly (no `route.startDistance` offset),
while `placeCarts` renders carts at
`route.wrap(route.startDistance + rider.travelled)`. My original reasoning
was: the hit-test in `simulate.ts` compares `rider.travelled` directly
against the hazard schedule's raw numbers, without ever calling
`route.pointAt`, so "the geometry and the hit-test agree on a coordinate
space" — and I concluded from that agreement that nothing was wrong.

That reasoning conflated two different questions. The hit-test's job is only
to decide *when* (in travelled-metres) a crossing happens, and it does that
correctly regardless of `startDistance` — travelled-space arithmetic never
needed the offset. But the geometry's job is to sit at the *world position*
a rider is actually at when that crossing happens, and that position is
`route.pointAt(lane, route.wrap(route.startDistance + travelled))`, per
`placeCarts` — not `route.pointAt(lane, travelled)`. I checked the first
(timing) and never checked the second (placement), and answering "is the
hit-test self-consistent?" is not the same question as "is the geometry
where the cart actually is?". It answered a nearby question and treated
that as answering this one.

Reviewer measured it directly on the built track: the lit zone sat 16.74m
from the cart that actually lit it, and a duck bar sat 16.77m from where a
rider actually bonks. It was invisible before this PR because the old
ring-wide sparking bug (bug 1) lit every zone together regardless of
position, camouflaging a positional offset in any single one of them; this
PR's per-zone isolation is what made it visible for the first time.

**Fix**: both `buildSparkRibbons` and the duck-bar-placing loop in
`buildRailRaceTrack` now convert a hazard's raw `at`/`from`/`to` via
`route.wrap(route.startDistance + raw)` before calling
`route.pointAt`/`outwardAt` — the same conversion `placeCarts` already
applied to `rider.travelled`. (`setAlerts`'s own `bar.at - lapOffset`
arithmetic was correctly untouched — that's travelled-space math with no
`route.pointAt` call in it, comparing against `lapOffset = me.travelled %
route.length`, so it never needed the offset in the first place.)

**Verified** the same way the reviewer measured the bug: built the real
track headlessly, read the actual `position` `BufferAttribute` for spark
zone 0/lane 3's first vertex and the actual instance matrix for duck bar
0/lane 3, and compared each against `route.pointAt(lane,
route.wrap(route.startDistance + travelled))` computed independently (the
same formula `placeCarts` uses, not re-derived from the fix itself). Both
now land at 0.0000m horizontal distance from where the rider actually is
(script not committed, deleted after use — same pattern as the bug 1
verification).

## Verify

```
npm run build   # exit 0
npm run check:rail-race
```

No browser QA done — did not have the shared Chrome profile. Visual QA
worth doing before merge: board the race, let a rival spark on the far side
while you're on a clear stretch and confirm only their lane's zone lights up
near them, not the whole ring; and hit a duck bar to see the new message.
