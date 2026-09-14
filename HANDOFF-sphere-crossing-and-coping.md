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

## (2) and (3) — NOT MINE TO FIX: the fix exists on another branch

**`eng/bridge-bend` is not in PR #620's base.** Checked with
`git merge-base --is-ancestor`:

- `0c37d151` "The hump bends with the planet: state its shape in altitudes,
  not in world y" — **NOT an ancestor of `eng/sphere-ground-claims`**
- `9c3fc274` "The arch is rigid in the tangent frame, not flat in world y" —
  **NOT an ancestor either**
- `git branch -r --contains 0c37d151` lists exactly one branch:
  `origin/eng/bridge-bend`

So PR #620 is failing (2) and (3) against code that predates the bend fix.
`surfaceProfile` on this base is still the world-y form the brief names as the
root cause:

```ts
return ground + (crownY - ground) * (1 - profileDrop(q));   // this base
```

and on `eng/bridge-bend` it is the altitude form:

```ts
return worldYAtAltitude(x, z, (crownAlt - localRise(x, z)) * (1 - profileDrop(q)));
```

`git diff HEAD origin/eng/bridge-bend -- src/world/train/` is **+264/-… in
`bridges.ts` and +52 in `bridgeStonework.ts`** (the module that lays the
coping). The brief said to build on that lane's result rather than redo it —
the result simply is not on this branch.

**Recommendation: merge `eng/bridge-bend` into the sphere stack rather than
reimplementing.** Reimplementing would duplicate ~300 lines and conflict
head-on when the lane lands. Both (2) and (3) should be re-measured after that
merge; only what still fails then is real new work.

## Where (1) stands

Committed and pushed:
- `planStationLead` — lead backtracks onto its own side of the railway
- rail-aware station approach siting in `clearStationDistance`

`tsc --noEmit` exit **0**.

Pool sweep after both: **9 of 10 seeds have zero unbridged crossings.**
Seed 451 still fails — 12 flips, and they are **real**, not nearest-limb
phantoms: a segment/rail-polyline intersection counts **13 genuine crossings
of the rail centreline** by run 16, and the parity control holds (run starts
outside the loop, ends inside, 13 is odd).

Root cause of the residue is upstream of anything I own: **`SELF_CLEARANCE = 3`
in `train/route.ts`** lets the loop close to 3.95 m of itself, and CLAUDE.md
already names this constant for this exact seed. Measured remedies:

- **Raise it to 8.2** (derived: `FENCE_OFFSET*2 + FENCE_HALF_THICKNESS*2 +
  STATION_SPUR_WIDTH + PLAYER_RADIUS*2`): fixes 451, but **seed 24 then proves
  NO bridge site anywhere** and the park is invalid. Rejected, reverted.
- **A warp vector** (`parkWarp.ts`, the documented cure). Hand-probed
  `layoutRestart: 2` and `layoutRestart: 8` both build seed 451 with zero
  unbridged crossings. **Do not bake a hand-probed vector** — the module says
  vectors come from `scripts/warp-search.mts` and must clear both gates
  (`check:park` + the invariant oracle); the file records three vectors that
  passed one gate and failed the other. `scripts/warp-search.mts 451` was
  running when this was written; its result is the thing to bake.
- **Replace 451 in the pool** — explicitly sanctioned by CLAUDE.md ("fix the
  generator or replace the seed in the pool — and write down why").

### Measurement traps hit, for whoever follows

- `mv scripts/diag-*.mts` swept up **9 pre-existing tracked** diag scripts.
  Caught by `git status` and restored with `git checkout -- scripts/`. Remove
  scratch by exact filename.
- A warp sweep wrapped in `timeout 240` reported **0 unbridged on every
  vector**; the builds were being killed and `grep -c` read the empty output as
  a pass. Re-run without the timeout, two of five vectors still failed. Always
  assert the build actually completed, not just that the bad string is absent.
- `nohup ... &` inside a backgrounded tool call dies with its wrapper shell —
  the first warp search logged one line and stopped.
