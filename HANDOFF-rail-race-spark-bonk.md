# Rail Race: per-zone sparking + bonk message

Branch `fix/rail-race-spark-bonk`, rebased cleanly onto `main` (which now
includes PR #144's tie-frame fix — no conflicts).

## Status: done, PR open

Both bugs fixed, `npm run build` exits 0 (checked properly, not piped through
`tail`), `npm run check:rail-race` passes. Two commits, each builds clean on
its own.

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

## Not investigated, out of scope

While tracing coordinates I noticed `track.ts`'s duck-bar and spark-zone
geometry is built at raw route distance `bar.at`/`zone.from` directly (no
`route.startDistance` offset), while `placeCarts` renders carts at
`route.wrap(route.startDistance + rider.travelled)`. On the face of it these
look like they could be offset from each other by `startDistance`, but the
hit-test in `simulate.ts` never touches `route.pointAt` at all — it compares
`rider.travelled` directly against the hazard schedule's raw numbers, which
is the same coordinate space the geometry is built in. So — as far as I can
tell — it's self-consistent and not a bug; flagging only because it took a
minute to convince myself, in case a future reader has the same "wait, is
this offset by startDistance?" moment.

## Verify

```
npm run build   # exit 0
npm run check:rail-race
```

No browser QA done — did not have the shared Chrome profile. Visual QA
worth doing before merge: board the race, let a rival spark on the far side
while you're on a clear stretch and confirm only their lane's zone lights up
near them, not the whole ring; and hit a duck bar to see the new message.
