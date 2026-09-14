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
