# The rides ride the sphere

Branch `eng/rides-radial`, off `feat/sphere-combined`. Worktree
`.claude/worktrees/eng-rides-radial`.

Area: `coaster/route.ts`, `slide/solve.ts`, and the four ride-camera mounts.
Plus two QA regressions handed over: the cruiser through `castle-wall-lower`,
and the rail-race rider's arm 0.330 m through the cart side.

## The finding, and it is one bug with several faces

**Every ride draws its track leant and places its vehicle flat.**

`drawnOnSphere` (`src/world/rail/sweptRail.ts:73`) states the architecture and
it is a good one: *solve in the flat frame, draw on the sphere*. A route's
clearance solve, its physics and its invariants all stay flat, because
`placeOnSphere` is locally a rotation and so preserves a height above the
ground and a gradient. Only the drawn geometry is mapped.

The rails obey this. **The vehicles do not.** `Coaster.placeCart`,
`ParkTrain.placeCars` and `RailRace.placeCarts` all read the *flat*
`route.pointAt` and write a plain Euler yaw/pitch, with no lean at all. So the
cart is not on the track it is drawn beside.

### Measured, seed 428, `scripts/measure-cart-off-rails.mts`

Controls first, as CLAUDE.md asks:

| control | result |
|---|---|
| `placeOnSphere` at the park origin is the identity | **0.0000 m** |
| a known 1 m offset reads back | **1.0000 m** |
| lean displacement 6.2 m up, at r = 0 / 40 / 100 / 157 m | 0.000 / 1.130 / 2.903 / 4.795 m — matches the cap table in `RADIAL-INVENTORY.md` |

Then the thing itself, on the Sky Cruiser's 213.5 m circuit:

```
cart-to-rails gap: worst 10.826 m at 133 m along
  (flat point (-123.4, -27.3, 48.0), radius 132.4 m)
mean gap 3.418 m over 214 samples
```

**The cart is up to 10.83 m away from its own rails.** That is not a lean a
child would have to squint at; it is the vehicle flying beside the track.

### Why this is also both QA regressions

- **Cruiser through `castle-wall-lower`.** `cruiserStrikes`
  (`src/world/coaster/clearance.ts:366`) sweeps the car envelope along the
  **flat** route and raycasts the **leant** castle meshes (the castle is stood
  by `standInPlot` → `placeOnSphere`; `building/layout.ts:188` — *"the deck
  leans to the local surface normal with everything else outdoors"*). Two
  frames, one comparison. On seed 428 it reports **10 strikes**, including
  `castle-wall-lower`, `castle-courtyard-floor`, `castle-roof-deck`,
  `roof-pavilion` and bare `terrain`.
- **Rider's arm through the cart side.** `Player.setRidePose` ends in
  `faceOnGround` (`src/world/up.ts:101`), so the **rider** is tilted onto the
  sphere. `RailRace.placeCarts` gives the **cart** no tilt. She leans and the
  tub does not, which swings her arms out through its side. `poseRider` makes
  it worse by adding the bonk sway along world `+X` and the seat lift along
  world `+Y` rather than along the cart's own axes.

The check's own message steers a reader to `duckPose.ts` / `BONK_SWAY` and
**that is the wrong place** — 0.330 m is an order of magnitude past any
previously recorded value (historical worst: 0.023 m through). Do not widen
the cart; the comment at `check-rail-race.mts:1398` is right to forbid it.

## The fix

One helper, next to `drawnOnSphere`, because three callers want it:

```ts
rideFrame(flat, yaw, pitch, out)  // tiltToSphere(flat) * Euler(pitch, yaw, 0)
```

The lean is taken about the **flat** point's column — the same column
`drawnOnSphere` uses — so a cart and the rails under it lean by exactly the
same amount. Position is the caller's business: the coaster and the train need
`placeOnSphere` on their flat point; the rail race already returns a leant
point from its own `pointAt` and must not be leant twice.

## What is NOT the work here

`coaster/route.ts`'s `point.y - terrainHeight(...)` sites are **correct by
design** and must not be "converted". They are flat-frame clearance solves, and
`drawnOnSphere`'s docblock is explicit that mapping the route itself would move
every one of them for nothing. `ALTITUDE-INVENTORY.md`'s rows for that file
read as bugs and are not; the real fault is the frame *mismatch* at the
consumers. Same conclusion for `slide/solve.ts` until measured otherwise.

The coaster's energy drop and crest search were already fixed upstream in
`076fbcdf` — verified, not assumed: both now read `route.clearanceAt`.

## Model

**Opus** (`claude-opus-5[1m]`), chosen by the Overseer's brief. A replacement
runs the same model.

## Status

- [x] Root-caused, measured, controls run
- [x] `rideFrame` helper (approved by the lead engineer) — in `sweptRail.ts`
- [x] Coaster cart: **9.103 m off its rails -> 0.167 m worst**, 100% of circuit
- [x] Clearance sweep into the drawn frame — strikes 10 -> 9
- [x] Rail race cart: **90.00 deg -> 3.210 deg** cart-vs-rider up (0.020 m of
      hand swing against a 0.55 m half-width)
- [ ] **The castle carve** — the real remainder of the cruiser-through-castle
      bug. See below; it is a route-solver fix, not a frame fix.
- [ ] `ParkTrain.placeCars` — same shape, not yet done
- [ ] Ferris gondola climb (`boardY + height * CLIMB_METRES`, straight up +Y)
- [ ] `railRace/camera.ts`: world-`Y` rig, `camera.up` never set, `far = 400`
      clips the horizon of a 220 m sphere
- [ ] `slide/solve.ts` — not yet examined
- [ ] Browser QA on `/sky-cruiser`, `/rail-race`, `/slide`, `/ferris`

## The castle carve — the remaining cruiser bug, measured

`scripts/measure-castle-carve.mts`, seed 428. The carve pins the castle span to
**one absolute world y** (`castleY(WINDOW_TRACK_Y)` = -26.82) and turns it into
a per-column clearance with `wanted = windowY - terrainHeight(spot.x, spot.z)`.

The castle span is d = 96..126, over which the ground falls **14.6 m**
(-25.50 at d=96, radius 102.7, to -40.13 at d=124, radius 126.4). So a level
track through it is:

| d | radius | ground | track | clearance |
|---|---|---|---|---|
| 88 | 99.7 | -23.92 | -26.54 | **-2.62** |
| 96 | 102.7 | -25.50 | -26.82 | **-1.33** |
| 100 | 105.1 | -26.76 | -26.82 | -0.07 |
| 110 | 113.8 | -31.84 | -26.82 | +5.02 |
| 124 | 126.4 | -40.13 | -26.82 | +13.31 |

**The ride is genuinely 2.62 m underground for about 14 m of its circuit**, and
13.3 m too high at the other end. The repair loop that would lift it is
explicitly forbidden from touching controls within `WINDOW_FLAT +
WINDOW_RAMP*0.35` = 10.6 m of the span — which is exactly where the sag is, and
for a good reason (lifting inside a hole cut to fit the car is how you hit it).

This is the rail race's own `route.base` disease in a second place: *one
absolute world y held across a span the cap tilts*. The cure there was to split
it into a constant **clearance** plus a per-position base, and the same split is
wanted here — but with a constraint the rail race did not have: both window
openings must stay at one height in the **castle's** frame, or `Shell.ts` can no
longer cut them as a single band.

Worth knowing before attempting it: the castle is leaned **rigidly, about its
own centre column** (`standInPlot` -> `placeOnSphere`), while every route point
is leaned **about its own column**. Those two maps agree near the castle centre
and diverge as `d^2 / 2R` — only ~0.32 m at the footprint's edge, so that is
*not* where the 6.9 m discrepancy comes from. It comes from the flat authoring
frame being a poor model of the castle specifically: in that frame the castle is
a constant-y box while the ground under it falls 14.6 m, so the castle reads as
buried at its near edge and floating at its far one, and only becomes correct
once drawn.

## Notes for whoever picks this up

- Seeds **11, 326, 428** build at 220 m; the canonical seed does **not** (a
  pre-existing `railD 0.0` crossing throw, not ours — `HANDOFF-seeds-at-220.md`).
  So headless measurement *is* possible, on those seeds. Use `LGP_SEED=428`.
- `check:cruiser-clearance` is **honestly red** on seed 428 — exit 1, with the
  10 strikes above. (I first recorded it as exit 0. That was `tail`'s exit
  code, not node's, because I had piped it. CLAUDE.md warns about exactly this
  and it still caught me within the hour; measure the exit code of the process
  you mean, never through a pipe.)
