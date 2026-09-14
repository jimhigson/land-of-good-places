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

## Status

- [x] Root-caused, measured, controls run
- [ ] `rideFrame` helper + the three vehicle placements
- [ ] Clearance sweep into the drawn frame; re-measure the 10 strikes
- [ ] The four camera mounts (fixing the mount fixes the camera —
      `RideCamera.mountOn` is a plain reparent and never touches `camera.up`)
- [ ] `railRace/camera.ts`: `far = 400` clips the horizon of a 220 m sphere
- [ ] Browser QA on `/sky-cruiser`, `/rail-race`, `/slide`, `/ferris`

## Notes for whoever picks this up

- Seeds **11, 326, 428** build at 220 m; the canonical seed does **not** (a
  pre-existing `railD 0.0` crossing throw, not ours — `HANDOFF-seeds-at-220.md`).
  So headless measurement *is* possible, on those seeds. Use `LGP_SEED=428`.
- `check:cruiser-clearance` is **honestly red** on seed 428 — exit 1, with the
  10 strikes above. (I first recorded it as exit 0. That was `tail`'s exit
  code, not node's, because I had piped it. CLAUDE.md warns about exactly this
  and it still caught me within the hour; measure the exit code of the process
  you mean, never through a pipe.)
