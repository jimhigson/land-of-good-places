# HANDOFF — the canonical park cannot be built headlessly (rail crossing at railD 0)

- Branch: `eng/crossing-bridge` off `feat/sphere-combined`
- Worktree: `.claude/worktrees/eng-crossing-bridge`
- Model: **Opus 5 (1M context)**, chosen by the Overseer (Engineer default).
- Reports to: the Overseer session `landofgoodplaces-fc`.

## The throw

`new World` → `Scenery` → `bridgeKeepout` → `computeCrossings`:

> rail crossings: the drawn paths cross the railway at railD 0.0 (0.0, 125.8),
> which snaps to no proven bridge site.

## Root cause — measured, not inherited

`scripts/diag-crossings.mts` rebuilds the flip set exactly as `computeCrossings`
does (control: it reproduces the production throw's own railD and point).

**The four *drawn* crossings are all fine** — every one snaps to a proven site
within 0.4 m:

| railD | point | nearest site |
|---|---|---|
| 153.6 | (76.9, 44.1) | 0.4 m — snaps |
| 288.2 | (138.8, -50.9) | 0.2 m — snaps |
| 326.3 | (139.0, -82.4) | 0.3 m — snaps |
| 590.1 | (20.4, -20.2) | 0.1 m — snaps |

The offending fifth crossing is **not drawn at all**. It comes from
`crossings.ts`'s hand-sampled *esplanade march* — the straight line down `x = 0`
from the arch. Measured: the **nearest drawn path sample to the gate is 76.3 m
away**, and stays ~70 m away for the march's whole 32 m, so `sinceDrawn` never
leaves `-1`, the march runs its full length, and it flips sides on the railway
at (0, 125.8).

### Why the drawn network is 76 m from its own front door

`paths.ts` `GATE_CORRIDOR_START_Z = 54` is a hand-written copy of "6 m inside
the arch", true only while `ENTRANCE_GATE_Z` was 60. On this branch
`GROUND_SPHERE_RADIUS` is 220, so `PARK_SURFACE_SCALE` is 2.335 and the gate is
at **z = 142.8** — the authored gate corridor now starts **88.8 m inside the
arch**. CLAUDE.md's "two definitions of one thing, kept in step by hand".

### And there is no bridge site near the gate

`explainBridgeRefusal` over railD -20..+36 of the loop point nearest the arch:
**every width and angle refused** (SHORT reach, or DECK BLOCKED). Nearest kept
sites are 30.7 m and 36.1 m along the loop. `selectSpaced` has a documented
"no gate-priority seeding" gap; it is not the cause here (nothing near the gate
is feasible at all), but it is adjacent.

## Fix being attempted

Derive the corridor's start and inner end from `ENTRANCE_GATE_Z` (one owner)
instead of hard-coding metres. At scale 1 this reproduces main's 54 / 30 exactly.

## Instruments

- `scripts/diag-crossings.mts` — flips, sites, march profile. Control: must
  reproduce the production throw.
- `scripts/diag-gate-site.mts` — bridge-site feasibility along the loop near the gate.

## Result (measured)

**The fix is two constants in `paths.ts` given their proper owner** — the gate:

```
const GATE_CORRIDOR_START_Z = ENTRANCE_GATE_Z - GATE_CORRIDOR_ARCH_INSET; // inset 6
const GATE_CORRIDOR_INNER_Z = ENTRANCE_GATE_Z - GATE_CORRIDOR_DEPTH;      // depth 30
```

At `PARK_SURFACE_SCALE` 1 these are 54 and 30 — `origin/main` behaviour unchanged.

### Pool sweep, canonical geometry (`GROUND_SPHERE_RADIUS` 220, scale 2.335)

| | before (`eng/crossing-bridge~1`) | after |
|---|---|---|
| pool seeds that build | **3 of 10** (11, 326, 428) | **10 of 10** |
| nearest paving to the arch | 23.7 / 24.5 / 64.8 m | **3.5–4.4 m, all ten** |
| crossings bridged | — | **every one, every seed** (5/5, 2/2, 2/2, 5/5, 1/1, 3/3) |

The 3-of-10 exactly reproduces the record in `faece133`.

### `check:park`

Now *runs*. On the three seeds that built before, the regression list is
**byte-identical before and after** — the change is neutral there.

### `test:procgen`

| | before | after |
|---|---|---|
| passed | 269 | **473** |
| failed | 49 | 128 |
| **skipped** | **279** | **0** |

204 previously-skipped tests now pass; 81 previously-invisible failures are now
visible. Six baseline failures are gone, two of them squarely this bug:
`seed 326 > the walk in from the gate crosses the railway where the planner
planned it to, on a bridge` and `seed 11 > the bus stop and the walk in from it
are clear of trees and bushes`.

## Findings that are NOT mine (report, do not chase)

1. **Bridge ramps are cliffs at this scale.** `every railway crossing has a
   bridge you can walk to, onto and across` fails on canonical, 11, 24 and 326 —
   and it failed on 11 and 326 **before** my fix, so it is pre-existing. The
   planner's `WALKABLE_FLOOR = BRIDGE_RISE / MAX_RAMP_GRADIENT` is scale-free and
   correct; what has changed is the ground under the ramp. The park's own dome
   steepens as `PARK_SURFACE_SCALE` grows (constants.ts says so itself: 41 m of
   drop at radius 220), so a ramp planned at grade 0.09 is built at 0.98–2.18
   against a 0.512 budget. This is real crossing-planner work and it is an
   interaction with the sphere — the ramp planner has to plan against the
   sphere's own slope, not flat ground.
2. `poi.stranded`, `rail.walkable`, `anchor.reach:hotel`,
   `anchor.reach:ferrisWheel` — all four present, identically, before my fix.
3. `ferrisWheel` declares radius 13 m but builds to 14.9 m; the sky cruiser runs
   **5.2 m below ground** for ~30 m of its length.
4. The 81 newly-visible procgen failures are overwhelmingly Rail Race, Sky
   Cruiser, slide, trees and coping stones — the radial conversion's territory.

## The low bridge soffit: measured, and it is NOT the crossing planner

Asked whether "the train drives into its own bridges" shares my root cause.
It does not, and `scripts/diag-soffit.mts` separates the two candidates.

The crown solve is **not** on a flat datum — `terrain.ts`'s `terrainHeight`
already includes the sphere (`#511`), and `bridges.ts` samples it across the
whole crown footprint. So the candidates are:

- **sag model** — the crown misses the terrain's own fall across its span.
- **radial-up model** — the deck is placed along **world y** while the train's
  clearance is measured along the **local up**, which on a 220 m sphere tilts
  `asin(r/220)` from vertical. Reading = `TRAIN_CLEARANCE_Y * cos(tilt)`.

At the near bridge the two are indistinguishable — 3.560 vs 3.562 — which is
why that measurement could not settle it. **The far one settles it outright:**

| point | r | measured (checks engineer) | radial-up model | sag model |
|---|---|---|---|---|
| (-86.0, 26.0) | 89.8 | 3.69 | 3.560 | 3.562 |
| **(-99.0, 138.1)** | **169.9** | **2.49** | **2.477** | 3.083 |

The radial-up model is out by **0.013 m**; the sag model by **0.59 m**, 45x
worse. So the defect is `bridges.ts` building along world y and never having
been converted to radial up — which matches the inventory's own finding that
`bridges.ts` imports no sphere helper at all.

**Owner: the radial-up conversion, not the crossing planner.** Same cause as the
steep-ramp failures above (`every railway crossing has a bridge you can walk to,
onto and across`), whose arithmetic points the same way on 2 of 4 crossings and
is not yet fully pinned. Both are `bridges.ts` reasoning in world y.

## Bridges to radial up — measurement first, and I was wrong twice on the way

**Read this before trusting any earlier number in this file about clearance.**

### Correction 1 — my `need · cos θ` fit was a fit, not a mechanism

It predicted the checks engineer's 2.49 m at r=169.9 to 13 mm, which is why it
was believed. The lead then killed the rival candidate from the *code* rather
than by fitting: `deckMesh` (`bridges.ts:751-769`) is a 0.05 m invisible marker
composed with `setFromAxisAngle(Vector3(0,1,0), yaw)` — **a yaw about world +Y
and nothing else, so it never leans** — and there is therefore no
`halfDiagonal · sin θ` AABB inflation anywhere. Good: but a surviving fit is
still a fit.

### Correction 2 — my first instrument discarded the evidence

`diag-clearance.mts` initially required **both** rays to hit before counting a
point. That silently drops exactly the points where the two disagree most. Fixed
to track A and B independently.

### Correction 3 — and then its denominator was wrong

Sweeping the whole loop, B read "SHORT" at 3.757 / 3.628 m. Those points are
**not under a bridge deck** — the local-up ray was catching ramp undersides and
abutment faces, which is not a train-clearance question. On the honest
denominator (track points a bridge's own `deckCovers` claims), **B clears 3.900
on every seed measured**: 5.151 (seed 11), 4.381 (canonical), 5.072 (seed 326).

**So I do not reproduce "the train drives into its own bridges" at any point
genuinely under a deck.** The reported 2.49 at (-99.0, 138.1) is at no crossing
on seed 11 and may be the same artefact. That wants re-measuring before anyone
acts on it.

### What IS proven, and it is a different and better finding

| seed | track points under a deck | hit by world-+Y ray | hit by local-up ray |
|---|---|---|---|
| 11 | 10 | **10 (100%)** | 6 (60%) |
| canonical | 25 | **25 (100%)** | 11 (44%) |
| 326 | 25 | **25 (100%)** | 11 (44%) |

From a point standing directly under the deck, a ray along the **local up**
leaves the bridge entirely 40-56% of the time. A bridge that leaned with the
ground would be hit ~100% by that ray. **The bridge is built flat in a leaned
world** — proven three ways now, independently: this geometry, the lead's grep
(`bridges.ts` and `bridgeStonework.ts` import zero sphere helpers), and the
marker's world-`+Y`-only rotation.

That is visible to a child — a flat bridge sitting in tilted ground — and it is
the fix worth making. The clearance clause is a second, smaller fault on top.

### Scope of the conversion (NOT done — this is the next piece of work)

- `bridges.ts` (1567 lines) + `bridgeStonework.ts` (450) built in the flat frame.
- Lands in **one commit** with `invariants.ts:5323`, `:6612` and `:6357-6451`,
  which the lead has assigned to this area — geometry and clause are a pair and
  either alone turns the other red.
- Read `up.ts`'s `standHeight` (on `eng/radial-collide`) rather than `walkHeight`
  for any deck-to-deck or deck-to-fence comparison: `walkHeight` is a radius and
  cancels the planet only within one column, and two points 1.3 m apart at 90 m
  out differ by 0.54 m of planet. Guard the `-Infinity` sentinel.
- Consider **deleting** `deckMesh` rather than leaning it: it is a second
  definition of the soffit kept in step with the masonry by hand, and its own
  comment ("the invariants measure the built clearance off this box") is the
  promise CLAUDE.md says is not a mechanism.
- Read the rides engineer's "solve flat, draw leaned" (`drawnOnSphere`) before
  choosing how the shell leans — it may be the cheaper architecture here too.

## "Solve flat, draw leaned" does NOT transfer to bridges — measured

Correction 5's architecture is right for a ride and wrong for a bridge, and the
reason is correction 5's own stated edge: **`placeOnSphere` preserves a height
above the ground in its own column, but it does not keep the column.** It slides
a point outward by `height · sin(tilt)`.

For a ride that is harmless: the rider is placed by the same transform, so cart
and rail move together. **A bridge is a thing a child stands on and is stopped
by**, and those are keyed in the flat plan — the `MovingPlatform` by `(x, z)`,
the parapet walls from `planEdge`'s flat `(x, z)` pairs, and `covers` /
`heightAt` / `deckCovers` / `pavingHeightAt` all by `(x, z)`.

Measured, per-vertex `placeOnSphere` on the built park:

| crossing | r | tilt | deck height | deck moves | parapet top moves |
|---|---|---|---|---|---|
| (20.4, −20.3) | 28.7 | 7.5° | 4.73 m | 0.616 m | **0.746 m** |
| (−86.0, 26.0) | 89.8 | 24.1° | 5.47 m | 2.236 m | **2.644 m** |
| (51.4, 95.8) | 108.7 | 29.6° | 5.74 m | 2.838 m | **3.332 m** |
| (−14.0, 121.7) | 122.5 | 33.8° | 6.07 m | 3.387 m | **3.944 m** |
| (139.0, −50.8) | 147.9 | 42.3° | 6.87 m | 4.625 m | **5.298 m** |
| (138.9, −82.1) | 161.3 | 47.2° | 7.34 m | 5.382 m | **6.115 m** |

`PLAYER_RADIUS` is **0.62 m**. Every crossing exceeds it — the innermost one
included. At the outer crossings the drawn stone would stand **up to 6 m** from
its own collider and its own walk surface: she walks on air beside the parapet,
and is stopped by nothing where the stone now is. That is CLAUDE.md's "anything
that looks solid must be solid", made worse than the flat bridge it replaced.

**So the bridge must not be leaned vertex-by-vertex.** Two candidates, and this
is a decision for the radial lead, not for me alone:

1. **Rigid tilt about the crossing's own centre.** A bridge is a ~24 m rigid
   object, closer to a big prop than to a route. Tilting it about its own centre
   to the local ground normal keeps its centre exactly put and moves its ends by
   a bounded `halfLength · (1 − cos)` rather than by `height · sin`. Collider and
   walk surface follow by the same rigid transform, so they cannot desync.
2. **Move the whole bridge into the leaned frame**, queries included — every
   `(x, z)` lookup would have to un-lean its argument first. More faithful,
   much larger, and it puts a trigonometric inverse on the hot path of every
   walk-surface sample.

I have not chosen. (1) looks right and cheap; (2) is what a purist would want.
