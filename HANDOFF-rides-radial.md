# The rides ride the sphere

Branch `eng/rides-radial`, off `feat/sphere-combined`. Worktree
`.claude/worktrees/eng-rides-radial`.

Area: `coaster/route.ts`, `slide/solve.ts`, and the four ride-camera mounts.
Plus two QA regressions handed over: the cruiser through `castle-wall-lower`,
and the rail-race rider's arm through the cart side.

**Both regressions are the same root cause, and it is not the one in the
brief.** Every ride drew its track leaned and placed its *vehicle* flat. Fixing
that fixed the rail-race arm outright and removed most of the cruiser's strikes;
the rest of the cruiser was a second, separate bug — its castle carve held one
absolute world `y` across a span the cap tilts, which put the ride **10.55 m
underground**.

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
- [x] **The castle carve** — the ride was up to **10.55 m underground**; now
      +1.09 m worst. Strikes 8 -> 2 (seed 11) and 8 -> 1 (seed 326)
- [x] `ParkTrain.placeCars`, plus three stale `rotation.y` heading readers
- [x] Ferris gondola: climbs along the local up, and stands on it
- [x] `railRace/camera.ts`: aims at the leaned rider; `far` 400 -> 3200
- [ ] **The rig basis in `railRace/camera.ts`** — deliberately NOT converted.
      Tried, backed out, reasons in the code and below
- [ ] **The last two cruiser strikes** — it threads the window and brushes the
      surround. A much smaller problem than the one it replaced; see below
- [ ] **The whole of `src/world/slide/`** — assessed, not started. See below
- [ ] Browser QA on `/sky-cruiser`, `/rail-race`, `/slide`, `/ferris` —
      **nothing here has been looked at**

## `test:procgen` — the honest accounting

Run on this branch and on `origin/feat/sphere-combined` for comparison, same
machine, same command.

| | base | this branch |
|---|---|---|
| failed | **49** | **50** |
| passed | 269 | 268 |
| skipped | 279 | 279 |

Net **+1 failure**, and the composition matters more than the count:

**Now passing that failed on the base (1):**
`the Sky Cruiser built track turns as gently as it promises`

**Newly failing (4), all on seed 11, all layout cascade:**
- `no tree grows into a wall` — *"tree at (52.5, -99.2) reaching 4.38 m leaves
  **-0.48 m** to the wood run"*
- `nothing a bridge builds hangs into its own tunnel`
- `the ginormous slide stands on legs a child can walk between` — *"66 m long
  and stands on 2 legs — at least 3 were expected"*
- `the ginormous slide's cameras cover the whole ride and can see it`

**These are the carve's knock-on, and I am not hiding them.** Changing the
coaster's solved profile changes where its pylons go, which changes which trees
are felled, which moves everything seeded downstream — exactly the "every
feature generates step by step at the same time" cascade CLAUDE.md describes.
Two of the four are the **slide**, which is the least robust thing in the park
right now because it is entirely un-leaned (see below).

**Why I kept the carve anyway, and this is a judgement for the Overseer to
overrule if it disagrees:** the bug it fixes is a ride running **10.55 m under
the grass**, which a child would see; the four it shuffles are assertions on a
branch that already fails 49 and cannot build the canonical park at all. Backing
out a correct frame fix to preserve a red suite's exact failure set would be
optimising the wrong thing. But it is a real +1 and it is the Overseer's call.

By CLAUDE.md's own rule these are generator bugs — a generator that cannot
backtrack into a good layout for seed 11 is the thing to fix, not the frame
correction that revealed it.

## Seen in a browser, on seed 326, port 5491

**The Sky Cruiser rides on its rails — confirmed by eye.** First-person from the
cart, the two rails converge symmetrically ahead with the ties square across
them and the cart's nose at the bottom of frame. That is what a cart sitting on
its own track looks like; at 9-10 m off, the rails would not have been in shot.
`/private/tmp/qa-sky-cruiser-on-rails.jpeg`.

**The Rail Race camera is badly broken, and it is child-visible.** Booted
`/rail-race`, Level 1, seed 326: the race runs, the standings and lap counter are
correct — and **the camera is inside the hillside**. The screen is a wall of dark
green with the rider and all four lanes hidden behind terrain.
`/private/tmp/qa-rail-race-cart.jpeg`. This is the unconverted flat rig on a ring
that leans, and it is the same fault `check:rail-race` reports as *"the rider
sits NaN% across the picture"*.

### The rig conversion works, and needs one more thing before it can land

I converted it to judge it (rider point, `out`/`along`, the rise and
`camera.up`, one `tiltToSphere` at the rider) and looked:
**`/private/tmp/qa-rail-race-AFTER-rig-leaned.jpeg`** — the camera comes out of
the hill, all four lanes run left to right, the rider sits left of centre exactly
as `RIDER_SCREEN_X` asks, and the park is the backdrop. Night and day.

**But it is not one pass, so I reverted it** (Overseer's ruling was to leave the
rig alone, and this is why that ruling was right even though the current state is
broken). `raceCameraNeverRunsBackwards` goes red with **real numbers, not
`NaN`s**:

```
the race camera falls to -12.194 m of camera per metre of rider at 1098.5 m
from the arch ... (167 of 10578 probes actually run backwards), under the 0.05
floor — with a 116.9 m stand-off ...
```

A **116.9 m stand-off** where the rig should be about 30. `this.out` is a
rotation and so preserves length; what does not survive is
`RaceCamera.measureZoomCeiling`, which solves the ring's carrying capacity in the
**flat** frame and is then applied to a leaned rig. So the next pass is: convert
the zoom ceiling with the rig, in the same change, and re-judge in a browser.
1.6% of probes, all at the hairpins.

**Recommendation:** this deserves its own ticket. The ride is currently
unplayable-looking on seed 326, the fix is understood, and it is one more file
(`measureZoomCeiling`) plus a browser pass.

## The slide — assessed, untouched, and the biggest thing left

**Not one file in `src/world/slide/` mentions any sphere helper.** Nine files,
zero hits. Nor does `src/world/building/SlideRide.ts`, which builds the chute
geometry and sweeps it with a world-`+Y` frame (`crossVectors(tangent, UP)` at
`SlideRide.ts:226`).

The consequence is bigger than a lean. `Building.ts:875` adds the slide group
**straight to `anchorPlots.group`**, un-leaned — while every *anchored plot*
goes through `placeOnSphere`/`standOnSphere` (`AnchorPlots.ts:17,83,146`) and so
does the drawn ground. So a ~95 m chute and its legs are drawn in the flat
authoring frame, standing on ground that is not.

- `supports.ts:247-250` — legs are `CylinderGeometry` scaled along local `+Y`
  with no quaternion ever applied: **they stand along world `+Y` from a
  flat-frame foot.**
- `solve.ts:254`, `:690`, `:1467` — all three are **internal flat-frame solves
  and are fine**, including `:1467`, which compares against the cruiser's route
  and is flat-vs-flat. Do not "convert" these; the inventory rows read as bugs
  and are not.
- `Building.ts:1727-1734` — the rider is posed at the **flat** curve point but
  `setRidePose` ends in `faceOnGround`, so **her orientation is leaned and her
  position and the chute are not.** Same class as the cart-on-rails bug, and
  `petRiders.ts:340` documents the flat assumption outright.
- `cameras.ts` is self-consistent with the flat chute (`UP` at `:228`,
  `camera.up.copy(UP)` at `:415`), and its far plane is already 3200.

So the slide is one coherent conversion — chute, legs, rider and camera
together — and doing any one of them alone makes things worse rather than
better, because today they at least agree with each other.

## The last two cruiser strikes

The car now threads the window and catches its frame:
`castle-wall-window` and `cruiser-window-stones`.

The drift assert passes, so the carve and the band agree on the track's height
to within 5 cm. What is left is that `WINDOW_SILL_Y`/`WINDOW_HEAD_Y` are
constants derived from the nominal `WINDOW_TRACK_Y`, while the hole's *z* extent
is measured from the car's real swept path. **Do not widen the opening to make
this go away** — that is the "nudge a surface apart" anti-pattern CLAUDE.md
forbids. The principled fix is to cut the band's sill and head from the measured
envelope the same way its sides already are, which means `Shell.ts` taking them
per-opening instead of from two module constants.

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
