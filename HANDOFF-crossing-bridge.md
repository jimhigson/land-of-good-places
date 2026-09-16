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

## STOPPED — Jim halted the instance-by-instance radial conversion

14 Sep: *"trying to fit the new world into the old code."* An architect is
designing a proper spherical domain (canonical coordinate a 3-vector from the
planet's centre, flatness as a declared chart with a validity radius, one
translation layer), ~8 weeks. **No geometry was written**, which is the cheapest
possible place to be stopped. Nothing here is reverted; Jim asked that it be
kept.

The ruling that is now moot as an instruction but stands as a record: rigid tilt
about the crossing centre, tilt owned by the `SpineFrame`, `d·(1−cos θ)` =
0.027 m innermost / ~1.03 m outermost on `DECK_HALF_LENGTH` 3.2 m.

**One correction to that ruling for whoever picks it up:** `SpineFrame` is purely
2D — `worldAt` returns `{x, z}` and `project` inverts `{x, z}` → `{along,
across}`, with no `y` anywhere. A rigid tilt displaces a point in plan as a
function of its **height**, so the frame as it stands cannot carry the tilt. The
honest one-owner fix is the other direction: make all four footprint definitions
read from the **drawn sweep** (`shell.planEdge`), which already produces the true
polygon and which `insideDrawnStone` already follows.

## `scripts/diag-bridge-solid.mts` — and the false alarm it nearly shipped

The mandated solidity/reachability instrument. **Result on today's flat code, all
controls passing: 24 of 24 bearings stopped at both bridges, and 125 of 125
points carried at both.** No present-day defect.

It took three goes to be worth anything, and each failure is the same disease:

1. **Control failed for an unrelated reason.** It marched from a fixed
   `crossing + (60, 60)` and was stopped — because that spot happened to be
   inside scenery, not because the probe was broken. A control that fails for a
   reason unrelated to what it controls for voids the run and teaches nothing.
   Now the open spot is *searched for*, with `isClearCircle` as the authority.
2. **The probe was blind to the thing it was measuring.** `WalkSurfaces.sample(x,
   z, y)` answers "the surface at or below `y`", and it sampled from a fixed
   `ground + 6`. These decks are 4.73 m at the innermost crossing and **7.34 m**
   at the outermost — so it could not see the outer deck at all. It reported
   **64 of 125 points uncarried with an 8.87 m fall**, which reads exactly like a
   catastrophic bug and was entirely the probe's own blind spot. Sampling from
   `bridge.heightAt(x, z) + 2` gives 125 of 125.

**The lesson, and it is the one worth carrying into the redesign:** the controls
that caught 1 could not catch 2, because they were run on open grass where there
is no deck to be blind to. A control proves the probe can produce both verdicts;
it does not prove the probe can see the object. Both are needed, and only the
second would have caught an 8.87 m headline that was pure fiction.

## CI on #619 — read this before merging

**Correction to an earlier claim of mine: CI *does* run on this PR.** I reported
"no check runs"; that was `gh`'s `statusCheckRollup` returning empty, not the
truth. Seven runs, two red.

**The base branch's last CI was 11 September at `36ee9ce4`.** Every commit after
it — including `faece133`, which broke the park — **never ran CI at all**. That
is why nothing went red when the park stopped building. At that last measured
point: `Checks` **success**, `Coplanar faces` **failure**.

### `Checks` — red at `check:npc-perch`, NOT mine

*"climbable tree 0 has no foliage to measure."* Proved by running it on the
**base branch** with seed 428, which builds there, so no throw is involved:
**it fails identically**. Pre-existing, introduced between 11 and 14 September by
the scale work. On the unfixed branch it dies on the crossings throw instead, so
this PR reveals it rather than causes it.

### `Coplanar faces` — red, and **40 NEW findings that were unmeasurable before**

On the base, `check:coplanar` **dies on the crossings throw at the first seed and
sweeps nothing** — so its "0 findings" was never a measurement. Same disease as
`test:procgen`'s 279 skips.

The 40 break down as **27 railRace**, 6 garden, 2 scenery, 2 entrance, 1
park-train, 1 fountain, 1 anchor-plots. The railRace majority is rail-vs-rail and
rail-vs-sleeper self-coplanarity — the radial work's meshes, untouched by this
PR's two constants.

**The honest gap, stated rather than resolved.** Four findings name path/kerb
meshes:

```
garden|entrance/entrance-gateway-path|entrance/entrance-road-kerb   seed 131
garden|garden/path-kerb|garden/path-surface        3.966 m²         seed 326
garden|fountain/<CylinderGeometry>|garden/path-surface              seed 128
garden|garden/path-kerb|scenery/stone-walls/<BoxGeometry>           seed 208
```

Seeds 131, 128 and 208 did not build before this PR, so theirs are newly visible
by definition. **Seed 326 did build**, and this PR changed its park (6 crossings
to 5, nearest paving to the arch 24.5 m to ~4 m) — so I **cannot** separate
"newly visible" from "newly created" there, because the base check cannot run at
all to be compared against. `LGP_SEED` is not respected by `check:coplanar`, so
there is no per-seed comparison available either.

What can be said: `path-kerb` vs `path-surface` is a path's own two drawn layers
(`pathGraph.ts` draws a cream kerb with the sandy surface a few centimetres
proud), so it is a property of how every path in the park is drawn rather than of
where this one goes. That is an argument, not a measurement, and it should be
treated as such.
