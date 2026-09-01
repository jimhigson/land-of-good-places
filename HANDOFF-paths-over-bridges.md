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
