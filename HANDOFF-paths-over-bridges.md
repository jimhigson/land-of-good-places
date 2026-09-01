# HANDOFF — paths cross bridge decks (#436)

Branch `feat/paths-cross-bridge-decks`, worktree `.claude/worktrees/paths-over-bridges`.
Dev server port 5575.

## Measured baseline on origin/main @ 3eb884af (1 Sep)

`scripts/tmp-feet.mts` (throwaway), five procgen seeds:

| seed | proven sites | bridges built | poi placed | **poi.stranded** |
|---|---|---|---|---|
| 20260728 | 3 | 2 | 248/248 | **0** |
| 5 | 4 | 3 | 254/254 | **0** |
| 11 | 2 | 1 | 259/259 | **0** |
| 18 | 1 | 1 | 214/214 | **0** |
| 24 | 1 | 1 | 218/218 | **0** |

**#436's headline symptom is already gone.** Seed 5's dodgems at (38.4, 36.3) is
no longer stranded — nothing is, on any of the five seeds. Whatever landed
between the ticket being written and today (#431/#440/#416 are the candidates)
closed the connectivity half. Do not go looking for it.

## What is still there: Jim's clump, and its exact mechanism

Canonical seed, the entrance bridge — proven site railD 0, centre (0, 40),
axis (0,-1), halfWidth 4.0, footprint along -15.4..18.4 (i.e. z 21.6..55.4).
The gate arch is at z = 54, so **the arch stands 1.4 m up the bridge's own
north ramp.**

`gate-approach` is drawn as (control points, `ROUTES`):

```
(0.00, 54.00)   the arch
(0.00, 45.80)   corridor mouth — 2.6 m up the north RAMP
(2.93, 45.80)   stub corner
(2.93, 55.38)   lattice node — 9.58 m back NORTH
(0.00, 56.42)   the crossing's own north foot
(0.00, 20.64)   over the deck to the south foot
(2.93, 19.38)   ...
```

Projected on the bridge axis the walk goes **-14 → -5.8 → -15.4 → -16.4 → +19.4**:
it climbs 8.2 m of ramp, **reverses 10.6 m**, then crosses. 59.6 m of 3.2 m
ribbon laid to make 33.4 m of southward progress, all of it inside the
bridge's footprint. That is the "big clump of path around the first bridge".

### Root cause

`streetLatticeSearch` registers a crossing as a **lattice edge between two grid
nodes** (`dir: 8`), with the feet and the deck as interior `via` points. The
feet are therefore **not nodes**, so nothing can attach to them. The only way
onto a bridge is to reach one of the two grid nodes its own `streetStubs`
happened to find — and here that node is 9.6 m *behind* the mouth.

### Why the existing scorer does not catch it

`gateApproachSearch` prices retrace at `RETRACE_PENALTY = 8`, but
`retracedLength` only counts corners sharper than 135 degrees. This hairpin is
offset 2.93 m sideways, so **every corner in it is a right angle and
`retracedLength` returns 0.** The scorer is blind to an offset hairpin.

## The fix being built

Bridge **feet become first-class lattice nodes**, so any stub may land on one
and cross the deck. Entry stays at the feet only — a junction *mid*-ramp is
the original #414 defect and must not come back.

## The clump, measured (2 Sep) — paved area inside each built bridge's footprint

Rasterised at 0.25 m from the **drawn** ribbons (`routeCurve` + each route's own
width), over the site's own proven footprint rectangle. "One ribbon" = the
3.2 m avenue running the footprint's length, i.e. the least a crossing can cost.

| seed | site | footprint | paved | % of footprint | vs one ribbon |
|---|---|---|---|---|---|
| **20260728** | **railD 0 (0, 40) — the entrance bridge** | 281 m2 | **180 m2** | **64%** | **1.67x (+72 m2)** |
| 20260728 | railD 234 | 377 | 151 | 40% | 1.28x |
| 5 | railD 12 | 372 | 131 | 35% | 1.13x |
| 5 | railD 56 | 377 | 172 | 46% | 1.46x |
| 5 | railD 142 | 366 | 140 | 38% | 1.23x |
| 11 | railD 30 | 377 | 107 | 28% | 0.91x |
| 18 | railD 4 | 366 | 146 | 40% | 1.28x |
| 24 | railD 20 | 377 | 110 | 29% | 0.93x |

**It is not every bridge and not every seed.** Two of the eight built bridges
carry less paving than a single ribbon. The canonical seed's entrance bridge is
the worst by a clear margin, and it is the one Jim looked at.

Deepest single backwards run along a bridge's own axis, per seed (fixed
instrument; controlled against the hand-computed 10.6 m on the canonical
control polyline, instrument says 11.6 m on the bowed drawn ribbon):

- 20260728 **11.6 m** (`gate-approach`, railD 0)
- 5 **15.4 m** (`spur-stall.waterFight`, railD 142); `gate-approach` 13.5 m
- 11 6.7 m; 18 9.4 m; 24 2.1 m

Caveat on that metric: where the arch is off the bridge's axis (seed 18) a
legitimate walk *to* the toe reads as a backtrack. The canonical seed and seed
5's gate approach are unambiguous — arch, mouth and bridge share one line.

## Verdict: paths ALREADY cross decks. #436's premise is stale.

`gate-approach` lays 69.9 m inside the entrance bridge's footprint and crosses
it on the deck. `streetLatticeSearch` has registered every crossing as a
lattice edge (`dir: 8`) whose `via` runs foot, deck, centre, deck, foot since
before this branch. A bridge is already part of the path network.

The clump is **not** paths going round a ramp they cannot climb. It is the walk
climbing the ramp, going back down and sideways to a grid node in order to be
*allowed* to start the crossing, and climbing it again — because **the
crossing's feet are not lattice nodes**, so the only way onto a bridge is via
the two grid nodes its own `streetStubs` happened to find.

## Three cheap fixes considered, all measured into an existing constraint

1. **Feet as lattice nodes** (the obvious one). On the canonical seed the mouth
   is (0, 45.8) and the north foot (0, 56.42): `direct` = **10.62 m**, against
   `computeStreetStubs`' straight-stub gate of `STUB_TAIL_LIMIT + 2` = **9.8 m**.
   The stub is refused, and both elbow corners are degenerate (mouth and foot
   share x = 0). So this does not fix the canonical case without moving
   `STUB_TAIL_LIMIT`, which is a threshold and is not available.
2. **Collapse the hairpin in a post-pass.** The limb it would delete ends at
   lattice node (2.93, 55.38) — which is **exactly the first control point of
   `spur-stall.railRacer`**. Deleting it strands that spur off any paving:
   `no paved path stops anywhere but a destination`.
3. **Teach `retracedLength` about offset hairpins** so `gateApproachSearch`
   scores this candidate honestly. Real bug — every corner in the hairpin is a
   right angle, so the scorer returns 0 — but it only helps the gate approach,
   and only if a better candidate exists on that seed. Unverified.
