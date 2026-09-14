# HANDOFF — unbridged rail crossing, bridge ramp grade, coping seating

Branch `eng/sphere-crossing-and-coping`, off `origin/eng/sphere-ground-claims` (PR #620).
PR target: **`eng/sphere-ground-claims`**, not `main`.

**Model: Opus 5 (1M context). Chosen by the Overseer's dispatch (Engineer default).**

## Scope

Three of PR #620's five red checks. Everything else on that branch is somebody else's.

1. Unbridged rail crossing — blocks `Coplanar faces`, `Entrance road`, `Swept bus` (one throw)
2. Bridge ramp grade — `Procgen invariants`
3. Coping blocks not seated — `Procgen invariants`

## (1) Unbridged crossing — ROOT CAUSE FOUND, fix in progress

Reproduces on **seed 451 only** (1 of the 10 pool seeds). All other seeds clean.
The CI throw: `railD 133.9 (37.9, -40.1) ... snaps to no proven bridge site`.

**It is a routing fault, not a siting fault.** Proved two independent ways:
- segment/rail-polyline intersection: the station-0 `lead -> approach` leg
  crosses the rail centreline exactly once, at railD 133.6;
- point-in-polygon on the loop: `lead` is OUTSIDE the loop while `approach`
  and `stand` are INSIDE.

The router is **`spur-station-0`** (run 16), built in `paths.ts` ~line 4086. Its
`points` append `approach` and `stand` as RAW points after the street route —
neither goes through the rail-aware `routeLeg`.

The bad datum: `plan.ts`'s `leadX: standX + parkX * 6` — a bare **6 m** step
"straight out into the park". Seed 451's loop runs back **within 3.95 m of
itself** beside station 0, so the platform's park side is an isthmus narrower
than 6 m and the step lands across the other limb (perp 0.76 from a rail
centreline, wrong side of the railway from its own platform).

`crossingPlan.ts` states the now-false premise in as many words: *"the loop is
simple (never self-crossing), so the sign is stable park-wide."*

### Measurements (whole pool, before)

| | stations affected |
|---|---|
| `stand->lead@6m` crosses the rail | seed 451 st0 only (1 crossing) |
| furthest clear park-ward step | 451 st0 **5.00 m**; 24 st0 8.00 m; all others >=12 (sweep ceiling) |
| min swing keeping the full 6 m, margin `FENCE_OFFSET + spur/2` = 3.30 | 18 of 20 stations **0 deg (unchanged)**; seed 24 st0 **35 deg**; seed 451 st0 **50 deg** |

### Done so far

- `clearance.ts`: new `STATION_SPUR_WIDTH = 2.6` (one owner; `paths.ts` paves
  with it, `plan.ts` sizes the lead against half of it).
- `plan.ts`: `planStationLead()` — keeps the 6 m reach and **turns the bearing**
  into the platform's empty half until both drawn legs clear every *foreign*
  limb by `FENCE_OFFSET + STATION_SPUR_WIDTH/2`. Park-ward is tried first, so a
  station with room keeps exactly the lead it always had.
- Verified: seed 451 st0 lead is now side +1, matching its approach and stand
  (perp 3.60); unchanged stations still read the old perp 8.15 exactly.

### !! OPEN — the fix moved the defect, did not remove it

Seed 451 went from **1** unbridged crossing to **12**. With the lead now on the
platform's side, `streetRoute` (which IS rail-aware and refuses a side change)
returns null, and `fallbackSpurRoute` weaves run 16 across the pinch 12 times
around (46-51, -26..-34). `fallbackSpurRoute` does call `routeLeg`, so it is
rail-aware in principle — but at a 3.95 m pinch "which side am I on" is decided
by NEAREST LIMB, so the side sign flips without anything crossing, and every
side-holding screen downstream is confused.

**Next step being tested: `SELF_CLEARANCE` in `train/route.ts`.** It is still a
bare `3`, and CLAUDE.md already names it as this family of bug ("lets the rail
loop run back within 3 m of itself while a path needs 8.4 m to pass — it walled
off part of the park on seed 451"). Deriving it from the game
(`FENCE_OFFSET*2 + FENCE_HALF_THICKNESS*2 + STATION_SPUR_WIDTH + PLAYER_RADIUS*2`
~ 8.2 m) should remove the pinch, and with no pinch the lead's plain 6 m step
may well clear on its own. **Blast radius is the whole rail loop on every seed**
— must re-measure all 10 seeds build + close.

If raising it makes seeds fail to close, fall back to reporting the pinch as an
upstream defect rather than forcing it.

## (2) and (3) — NOT STARTED

Ramp grade at (-22.4, 35.4); coping 0.033/0.037 m proud on bridges 238.0/300.0.
See the Overseer brief. Note the procgen job has **95 failures across 5 seeds**
— far more than these two; most are other agents' (gate arch, tree
interpenetration, rail-race duck bars, sky cruiser pylons).

## Instruments

In the scratchpad (NOT committed — do not `mv scripts/diag-*` , there are
pre-existing tracked ones, I nearly shipped a 9-file revert doing that):
`diag-crossing.mts` (flip vs site snap, per seed), `diag-station.mts`
(lead/approach/stand sides), `diag-selfpinch.mts` (real segment/rail
intersections + loop self-approach), `diag-control.mts` (point-in-loop),
`diag-angle.mts` (min swing per seed).

Control note: `diag-selfpinch`'s control A "ray from park middle" reads 0
crossings — that is correct, the loop's bbox starts at x=12.1 so (0,0) is
genuinely outside it. The premise was wrong, not the instrument.
