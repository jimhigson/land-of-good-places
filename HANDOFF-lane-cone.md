# HANDOFF — the cone in the road (e-lane-cone / PR #262)

Branch `e-lane-cone-work` (PR **#262**). Second agent's worktree:
`.claude/worktrees/e-lane-cones-out`, local branch `e-lane-cones-out-work`,
pushed to `e-lane-cone-work`. Dev server was **5447** (`--strictPort`), killed
by PID. 5200 / 5210 / 5412 never touched.

## Round 2: Jim's ruling, and what was done about it

> *"Can we just remove these mystery items? Use the actual tree models same as
> the game uses by the side of the road but not on it. Fix this quickly skipping
> a full qa and approval by me since this currently totally breaks the game.
> Also, collision on the bus is pointless anyway since it's basically an
> animated sequence."*

### 1. The cones are gone

`journey-park-rooftops` — 54 `ConeGeometry(1, 1, 7)` in `markerPink`, 2.4-4.6 m
across, 5-12 m tall — is **deleted outright**, not moved. They were meant to
read as rooftops over the wall, and they read as pink cones in a field, because
that is what they were: a roof with no building under it, meeting the grass at a
point. A silhouette that has to be explained is not doing a silhouette's job.

Round 1 moved them off the carriageway. That was the wrong fix and Jim was right
to reject it: the object should not have existed.

### 2. The trees are the park's own — one owner

New module **`src/world/treeModel.ts`**: `TreeKind`, `TREE_REACH`, `TREE_TOP`,
`pickTreeKind`, `rollTree`, `fileTreeParts`, `FOLIAGE_GEOMETRY`,
`foliageMaterial`, `makeInstanced`, `InstanceItem`. Both `world/Scenery.ts` (the
park's lawn) and `world/entrance/BusJourney.ts` (the lane) build from it.

`rollTree` was lifted out of `Scenery.buildFoliage` **draw-for-draw**, including
the order the object literals evaluate their properties in — that order *is* the
RNG draw order. Proven layout-neutral by measurement: `test:procgen` 316 passed
before and after the extraction, unchanged.

Both lane populations were lookalikes (cylinder + one `IcosahedronGeometry(1,1)`
ball). Now: `journey-tree-{trunks,canopies,cones}` on the verges and
`journey-park-tree-{trunks,canopies,cones}` behind the wall.

A useful accident: `pickTreeKind` rolls `blossom` about 18% of the time, so the
pink the rooftops existed to provide arrives anyway — from a thing a six-year-old
can name.

### 3. Beside the road, never on it

Kept from round 1 and generalised. `plantTrees(name, count, rng, where)` hands
the placement callback that tree's own `TREE_REACH`, so the caller sets the
**near face of the canopy** against the clearance line, not the trunk. Verges:
`ROAD_HALF_WIDTH + reach + 2.6 + …`. Behind the wall: `PARK_AHEAD_CLEAR + reach
+ …`. Hedge and canopy fixes from round 1 untouched.

Measured on the built lane: **nothing inside the carriageway at all.**

### 4. The fixed seed — acted on, not just noted

`createRandom(20260808)` (behind the wall) and `createRandom(19470116)` (the
verges) are gone. Both scatters now draw from **`PARK_SEED`**:

```ts
const LANE_SCATTER_SEED = 0x1a5e01 ^ PARK_SEED;
const PARK_AHEAD_SEED   = 0x9a12ee ^ PARK_SEED;
```

One salt per scatter, the convention `Scenery.ts`'s `TREE_SALT`/`BUSH_SALT`
already follow. **This is why the cone reached production**: a literal seed made
the lane byte-identical on every seed, dev and prod, so the five-seed sweep was
one sample taken five times and had no arrangement left to find. The five CI
seeds now measure five genuinely different lanes.

Safe because `PARK_SEED` is a module constant resolved at first import (a
literal, or `LGP_SEED` in Node), never chosen mid-run — so the lane, which is
built *before* the park exists, can read it. `parkFacts.ts` imports `BusJourney`
dynamically after setting `LGP_SEED`, which was already true and still is.

### 5. Collision — confirmed, nothing added

**There is still no collision anywhere on the journey.** The bus's `z` is
arithmetic off the ride clock (`busZ = -elapsed * BUS_SPEED`). Nothing in this
change adds a collider: `plantTrees` only builds `InstancedMesh`es and adds them
to `this.lane`. No `CollisionWorld`, no `addCircle`, no collider of any kind is
constructed anywhere in `BusJourney.ts` — grep it. Jim is right that collision
here would be pointless, and there is none to remove.

## Guards

`test:procgen` **321 passed / 11 files / 0 skipped, exit 0** (316 before; +5 is
one new invariant × five seeds).

New: **`nothing grows in the lane but the park's own trees`**
(`test/procgen/invariants.ts`, fact `laneGreenery` in `parkFacts.ts`).

Asks about **object identity, not shape**: a lane mesh must draw one of the three
`BufferGeometry` objects in `FOLIAGE_GEOMETRY`. A hand-built copy could be
pixel-identical and still fails — what goes wrong with a copy is never how it
looks the day it is written, it is that the original moves on and the copy does
not. Doubles as a **no-mystery-items** guard via the `LANE_FURNITURE` allow-list.

### Proven red four ways, each with real numbers

| mutation | result |
|---|---|
| A. park-ahead scatter put back on the road | carriageway guard **red** — `journey-park-tree-canopies` #85 reaching 3.88 m inside the edge |
| B. canopies swapped for a locally-built, pixel-identical `IcosahedronGeometry(1, 2)` | identity guard **red** |
| C. pink rooftops re-added, placed properly clear of the road | identity guard **red**; carriageway guard correctly **silent** |
| D. planting cut to 8 trees | floor **red** at 26 instances |

**C is the one to remember**: it is a defect the carriageway guard cannot see by
construction, which is why the two invariants are complementary rather than
redundant. **D exists because** "every tree is the park's own" is trivially true
of no trees at all — this repo's recurring green-because-incapable-of-failing
shape.

Everything from round 1 kept: the completion guard, the carriageway guard
(including the `cat-bus-journey` could-not-fail fix), the hedge and canopy
fixes, and `main.ts`'s missing `.catch`.

## Verified by looking

Headless Chromium via Playwright, throwaway profile, `channel: 'chromium'` —
real GPU confirmed each run: `ANGLE Metal Renderer: Apple M4 Pro`.

- `scratchpad/shots/fixed3-from-ride-end.png` — **the frame Jim saw**, against
  `cone-from-ride-end.png`. Road runs clean through the arch and over the hill;
  real park trees both sides; no mystery objects.
- `fixed3-approach.png` — an avenue of real trees, hedges hugging the kerb.
- `fixed3-gate-elevation.png` — side on, road clear past the gate.
- `realorbit-*.png` — 24-frame burst of the **real ride camera**, untouched, over
  the whole ride. `realorbit-02-t1.9.png` and `realorbit-21-t19.3.png` are the
  exterior orbit at each end: bus on a clean road, trees off the verge from every
  bearing the orbit reaches. (`orb-b*.png` are synthetic bearings from an
  invented radius — the burst is the honest one, since it uses the ride's own
  camera.)

## Measured, not estimated

- Lane: **233 536 triangles** (was 116 260 — it doubles). The park it precedes
  draws **3 670 100** across 4223 nodes, so the whole lane is 6% of the scene
  that replaces it 20 s later, and is still three instanced draw calls of trees.
- 400 verge trees produce **1218 instances**; 76 behind the wall produce 230.
- `scripts/probe-lane-trees.mts` prints all of it plus the carriageway table in
  one run. `scripts/probe-lane-cone.mts` deleted — superseded.

## Status

- [x] Cones deleted, trees are the park's own, placed by their own width
- [x] Seed taken from `PARK_SEED`, with the hazard named in the code
- [x] New invariant, proven red four ways; existing guards re-proven red
- [x] `npm run test:procgen` — 321 / 11 files / 0 skipped, exit 0
- [x] Visual QA, real GPU, money shot + real-camera orbit
- [x] No collision added; confirmed none exists
- [ ] `npm run build` — see below
- [ ] Pushed to `e-lane-cone-work`; **do not merge** (Overseer merges on green CI)
