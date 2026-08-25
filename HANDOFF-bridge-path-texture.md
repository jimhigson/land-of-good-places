# HANDOFF — the path goes over the bridge; the bridge gets honest about its height

Branch `bridge-path-texture`, off `origin/grid-aligned-park` (PR #286),
pushed to `grid-aligned-park`. Two pieces of Jim's 2026-08-24 feedback on
the humpback bridges that landed the day before.

## 1. "The floor on the bridge should be the normal path texture"

It is the normal path — not a copy of it, and not a bridge-shaped piece of
path-looking material.

- `pathGraph.ts` still draws exactly one sandy ribbon (`path-surface`) and
  one cream kerb (`path-kerb`) for the whole park. It now remembers the two
  meshes and the lift each was drawn at.
- `pathGraph.drapePathsOverBridges(surfaceAt)` moves the vertices of those
  two meshes that a bridge carries onto that bridge's surface, and
  re-derives their normals from the hump's own slope (a road shaded like
  flat lawn reads as a decal).
- `World.ts` calls it the moment `ParkTrain` has built its bridges — the
  earliest moment anything can answer, since `Garden` draws the paving long
  before the train has solved a loop.
- `bridges.ts` grew `Bridge.pavingHeightAt` / `bridgePavingHeightAt` — a
  deliberately *different* question from `covers()`, which reports where a
  walker's centre fits (paving less her body radius). A ribbon trimmed to
  that tears off both parapets.
- The shell's road top became a road *bed*, `BRIDGE_ROAD_BED_DROP` (0.06 m)
  under the walkable surface, so the paving lies on stone exactly as it lies
  on terrain everywhere else.

This is also the fix for the already-flagged "the ground path ribbon still
drapes through the tunnel" — it was the same bug from underneath.

### Landmine, already stepped on

**The kerb tears before the paving does, and it tears silently.** The
ribbon's edges are offset along the *drawn curve's* perpendicular; a bridge
measures across along its resampled spine's. On a curve those differ by
millimetres, and the kerb's outer edge lands exactly on the boundary — first
build carried 161 surface vertices and 85 kerb ones, splitting every kerb
down the middle while the paving itself looked perfect in a screenshot.
`PATH_CARRIER_SLACK` (0.25 m, `core/constants.ts`) is the stride that stops
a boundary two decisions approach from opposite sides being a boundary.

## 2. "The bridge could also be a little less tall"

**Measured first.** Before this round, on the canonical seed, the built
crowns stood **4.441 m** and **4.429 m** over the worst ground under the
track, against a `BRIDGE_RISE` of **4.250** — i.e. **0.19 m and 0.18 m of
spare**, essentially all of it `HEIGHT_MARGIN`. There was no slack lying
around to shave.

So the two terms that were not derived got derived:

- **`BRIDGE_DECK_DEPTH` was the file's own flagged claim** ("nothing in the
  built park measures a deck's own thickness back"), stated at 0.35 m. It is
  now `BRIDGE_DECK_SLAB (0.05) + BRIDGE_SHELL_MIN (0.05) +
  BRIDGE_ROAD_BED_DROP (0.06)` = **0.16 m**, the three pieces `bridges.ts`
  actually builds. `BRIDGE_RISE` falls **4.25 → 4.06**.
- **`HEIGHT_MARGIN` 0.15 → 0.05.** Its old note allowed for terrain wander,
  which the worst-sampled ground already answers — so it was a second blind
  allowance for the same thing. The crown's ground is now sampled at a fixed
  0.3 m pitch; refining that to 0.05 m moves the answer **0.0018 m**
  (measured, both bridges).

**Result, measured on the built park (canonical):**

| | before | after |
|---|---|---|
| crown over the ground under the track, bridge @rail 172 | 4.441 | 4.470 |
| crown over the ground under the track, bridge @rail 266 | 4.429 | **4.202** |
| soffit clearance over that ground | 4.09 / 4.08 | 3.99 / 3.98 (need 3.90) |
| footprint diagonal, bridge @rail 266 | 37.3 m | 36.0 m |

The cramped bridge (@172) did **not** come down, and the code now says why
out loud. Its ramps are short, so its road has already fallen **0.30 m** by
the far edge of the flat crown span, and the crown has to be raised by that
dip so the slab does not come up through the roadway. The dip — not the
clearance — is what sets a cramped bridge's height. It also went up 0.03 m
because the old solve was under-strict: **the crown slab stood 0.06 m proud
of its own roadway**, since the old constraint only kept the shell's
thinnest pinch over the *soffit* and knew nothing about the slab above it.

### What is left, and it is not much

`TRAIN_CLEARANCE_Y` is **3.90 m** and is 88% of the whole height. It is
`CAR_FLOOR_Y` (0.58) + a seated tallest child (2.92) + `RIDER_HEADROOM`
(0.40, covering a measured 0.346 m hat-pop transient), every term
re-measured by an invariant on every seed. Nothing there is shavable
without a **design** change:

- lower the carriage floor (0.58 m) — 1:1 onto the bridge height;
- or accept a hat clipping the arch.

Two measured follow-ups deliberately **not** taken here:

1. **`ARCH_CLEAR_HALF` is `TRACK_CLEARANCE + 0.5`, a blind stride.** Both
   canonical crossings measure |sin(path, rail)| = **1.000** — dead
   perpendicular — so the train's real half-extent along the path is 1.30 m
   against 1.80 m of flat crown. Making it angle-aware (`TRACK_CLEARANCE /
   |sinθ| + margin`) would take ~0.10 m off a cramped bridge *and* fix a
   genuine under-provisioning for oblique crossings, which the current
   fixed 1.8 does not cover past ~46°.
2. **Flattening the profile over the arch span** would remove the dip term
   outright (~0.30 m on a cramped bridge) — but it steepens the rest of the
   ramp, and bridge @172 already peaks at **0.581** against the walking
   physics ceiling of **0.62** (`HUMP_BLEND`'s own note). Do not try it
   without re-deriving that ceiling.

## The invariant

`theDrawnPathRidesOverEveryBridge` (`test/procgen/invariants.ts`) — measures
the built vertex buffers, four clauses, **all proven red before green**:

- drape switched off → *"the drawn path-surface sits 4.485 m off the bridge
  carrying it at (-23.3, 35.7)"* and *"a vertex at (-3.9, -27.5) sits at
  0.15 m, below the 4.10 m soffit standing over the track"*;
- `PATH_CARRIER_SLACK` set to 0 → *"the bridges carry 148 path-surface
  vertices but 70 path-kerb ones"*.

**One trap when extending it.** The "nothing left in the tunnel" clause is
anchored to the **rail centre line**, not to `deckCovers`. A first version
used the deck's own span and fired on perfectly good paving: the crown
soffit is flat only over `ARCH_CLEAR_HALF`, and past that the haunch curves
down, so a hump's road legitimately runs *below* the crown soffit's height
once it is out over the solid abutment (measured 4.06 m of road under a
4.18 m soffit, 2.4 m along, nothing wrong). And `deckCovers` unpadded is
incapable of firing at all — a ribbon has no vertices on its own centreline.

## Verified

- `tsc --noEmit` (src and `tsconfig.test.json`): clean.
- `npm run build`: **EXIT 0**, unpiped — the whole check chain plus
  `vite build`. `check:park` inside it: 19/19 attractions, 0 rail crossings,
  240/240 waypoints, all six invariants. `check:solve-cost` and
  `check:park-boot` both passed.
- `npm run test:procgen`: **433 passed / 14 files**, exit 0, zero skipped —
  up from 428, exactly +5 = one invariant × five seeds.
- Real-browser QA, headless Chromium 151 + swiftshader, dev server :5417
  (killed after): before/after pairs on the PR comment and on
  `qa-screenshots` under `bridge-path-texture/` — walking at the ramp,
  standing on the crown, the ramp foot close-up, and the train staged under
  the arch.

## QA deep links (canonical seed)

- Walking at bridge A's south ramp: `/spawn?pos=-17.9,20.6&facing=345`
- Head-on at the ramp:
  `/view?camPos=-17.4,2.2,18.6&camDir=-0.259,0.05,0.966&timeOfDay=12:00`
- Standing on the crown:
  `/view?camPos=-20.8,6.4,31.6&camDir=-0.259,-0.16,0.966&timeOfDay=12:00`
- The ramp foot seam:
  `/view?camPos=-15.0,2.4,23.5&camDir=-0.75,-0.25,0.66&timeOfDay=12:00`
- Bridge A from the side (train stages well here):
  `/view?camPos=-6.6,4.5,32.1&camDir=-15.5,-2,4.1&timeOfDay=12:00`
- Bridge B's long ramp:
  `/view?camPos=1.4,2.2,-7.5&camDir=-0.212,0.02,-0.977&timeOfDay=12:00`

Staging the train headless: `window.game.world.train.distance = 171;
window.game.world.train.placeCars()` under a `timeOfDay` freeze. Sim time
crawls at 1–2 fps headless, so never wait for a lap. `page.screenshot`
times out on the WebGL page — use a CDP session's `Page.captureScreenshot`,
and launch with `--enable-unsafe-swiftshader`.
