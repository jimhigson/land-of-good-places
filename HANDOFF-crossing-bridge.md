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
