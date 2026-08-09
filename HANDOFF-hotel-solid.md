# HANDOFF — hotel solid + reliable entry (`fix/hotel-solid-entry`)

Jim, playing, 9 Aug 2026: (1) *"The hotel building is not solid. I can walk
straight through it."* (2) *"The entry is too hard to trigger… it only
occasionally triggers if I step into exactly the right point."*

## Root cause, measured (not guessed)

**One bug caused both.** `registerTowerCollision` built the shell by walking
eight sectors and trimming **every** sector's *start* by the door's arc
(`doorArc = 0.32`), when only the two beside the doorway wanted trimming. So:

- six evenly-spaced **0.32 rad gaps** round the tower — 2.29 m of arc, 1.49 m
  clear of both walls' half-thickness, against a 1.24 m-wide child;
- the "doorway" itself was a **1.43 rad hole** — 9.4 m of chord for a 2.6 m
  door — so you could walk in *beside* the jambs, far off the door axis, and
  never touch the entry band. That is defect (2): "only occasionally, at
  exactly the right point" = "only when I happened to come in near the axis".

Measured on the built park before the fix, 48 bearings marched at the facade:
**22 got inside the 7.2 m shell, 8 reached its middle (radius 0.00 m).**

Everything else was fine: the octagon *was* registered, on the park's own
collision world, at the right coordinates, with `topHeight` Infinity (no
`topIsAbsolute` involvement), never cleared.

## What changed

- `Hotel.ts` `registerTowerCollision` — rebuilt as geometry: a closed ring of
  eight chords with the doorway in the **middle of one face** (vertices at
  ±½ sector off the door axis), the facade face split into two stubs either
  side of the jambs. Named exports `TOWER_SHELL_RADIUS`, `TOWER_DOOR_HALF`,
  `TOWER_BACK_ALONG`, `TOWER_FACADE_ALONG`.
- `Hotel.towerDoorBand()` — now derived from those (back wall → outer face of
  the facade) instead of hand-written 5.5/1.1, which stopped 0.45 m *inside*
  the facade plane.
- `tapSpacing.ts` — new `bandCrossed(band, fromX, fromZ, toX, toZ)`: segment
  vs the band rectangle (slab clip). One owner. Reduces exactly to
  `bandContains` for a zero-length segment.
- `Player.previousPosition` made public. **Load-bearing:** every
  `teleportTo`/`setRidePose` collapses it onto the destination, so a swept test
  is teleport-safe with no bookkeeping.
- `Hotel.checkDoorways` — all four portals now ask `bandCrossed`. The suite
  door's inner step-through region became a real band, `suite-portal`, in
  `layout.ts` (same region as the old `localX > halfX − 0.6`, now owned by
  layout).
- `scripts/park-harness.mts` — the inert `InteriorControls.iris` now runs its
  midpoint immediately. A no-op iris meant no change of space could *complete*
  headlessly, i.e. no check could ever have proved a doorway works.
- `scripts/check-hotel.mts` — probes 22 (solid from 32 bearings × 2 stride
  lengths) and 23 (32 walk-throughs × 4 strides × 8 phases; parallel passes).

## State

- Probes green with the fix; red proofs below.
- TODO when picking this up: browser QA, `npm run build`, `npm run test:procgen`,
  PR.
