# #481 — the park's front doorway is walled shut on some seeds

Branch `fix/gate-boundary-481`, off `origin/main` at `bd818210`.
Follow-up filed: **#483** (two defects seed 18 exposed, with the reproduction).

## The issue's diagnosis is wrong, and it matters

#481 says *"the boundary wall runs across the gateway"*. Measured on the built
park, it does not. The boundary wall's collision segments carry
`halfThickness 0.45` and on both cited seeds they stop cleanly either side of
the gap, exactly as `Garden.ts`'s `inGateGap` intends — `(4.47, 59.65)` and
`(-3.48, 60.44)` on seed 288.

**What shuts the door is the park railway** — `train/fence.ts`'s lineside fence
(0.18 m) and its track escort (`TRACK_CLEARANCE`, 1.3 m):

```
seed 288  fence   (2.64, 57.73) -> (0.01, 57.76) -> (-2.59, 57.41)   half 0.18
          escort  (2.47, 55.74) -> (0.13, 55.77) -> (-2.18, 55.46)   half 1.30
seed  18  fence  (-1.13, 59.87) -> (1.43, 58.85)                      half 0.18
          escort (-1.68, 57.94) -> (0.51, 57.07)                      half 1.30
```

`train/route.ts`'s `trainObstacles()` knew every plot and the Sky Cruiser's
dismount point, and had never been told the park has a way in.

## The fix, and the one non-obvious thing about it

The rule is asked of the **closed loop** (`loopKeepsItsCrossing`), not added to
`trainObstacles`. That is load-bearing: the piece search keeps only
`budgets.perJoint` = 16 candidates at a joint, so an obstacle changes which
candidates survive *everywhere*, not just where it stands. Measured — a keep-out
disc at the arch re-rolled the canonical park's loop (362 → 359 m) though its
railway was 13.3 m from the gate, and removed seed 115's loop entirely. Asked of
the closed loop, **fourteen pool seeds are unchanged and only 288 and 18 move**.

`GATE_WALK_RAIL_CLEARANCE` = arch half-width + `FENCE_OFFSET` +
`FENCE_HALF_THICKNESS` + `PLAYER_RADIUS` = 7.10 m, every term from its owner.

## Also fixed in passing

- `parkLayout.ts` had `GATE_ANGLE`/`GATE_RADIUS` hand-copied with comments
  promising they matched `entrance/layout.ts`. Now imported.
- `fence.ts` had the fence's own half-thickness as a bare `0.18` three times;
  now `FENCE_HALF_THICKNESS` in `clearance.ts` beside `FENCE_OFFSET`.

## The check

`pnpm run check:gateway` — one process per pool seed, walks a child from the
arch to `ENTRANCE_WALK_DEPTH` (12 m) inside it. **Not** in the `check` chain
(25 min against a 30 min cap); a step of the required `Procgen invariants`
workflow instead, so it gates merges from day one. The measurement is shared
with `test/procgen`'s `a child can walk in through the front gate` via
`src/world/entrance/gatewayWalk.ts` — one owner.

Proved red on `main`'s `route.ts` with everything else on this branch:
`1 of 16 seed(s) cannot be walked into`, seed 288, `the walk in from the arch
stops 2.0 m inside it`. Green after: all 16, 396 corridor cells blocked across
the pool (so the probe can see solid ground). The invariant was proved red on
seed 18 the same way.

## Seed swap

Sweep seed 18 → pool seed 131. Reason written into `seed-131.test.ts`; the two
defects seed 18's re-rolled park exposed are **#483**, not weakened here.

## Status

- [x] measured, cause found
- [x] fix, as a closed-loop property
- [x] `check:gateway` + procgen invariant, both proved red first
- [x] `test:procgen` 520/520, `build` 0
- [x] `pnpm run check` exit 0
- [x] PR **#485** raised — not merged (never merge your own)

## Which side yields: BOTH, and they were two different bugs

**1. The boundary wall's aperture — fixed here.** The hole in the wall was an
**angle** (`ENTRANCE_GATE_HALF_ANGLE`, 0.073 rad, hand-tuned) while the arch is
a **width** (`ENTRANCE_GATE_HALF_WIDTH`, 4.3 m). Two definitions of one thing in
units nobody can compare by eye, and the wall is laid by arc length along a
spline whose radius varies per seed, so where the stone actually stops is a
different number on every park. The segment test also asked about a *midpoint*,
so a 2 m chord whose middle cleared the gap still reached a metre into the
doorway. Measured on `main`, in the 7.00 m clear width 1.0-2.0 m inside the
arch, masonry (`halfThickness 0.45`) overlapped a player-sized body on **nine of
sixteen pool seeds**:

```
451 0.87 m   128 0.76   267 0.50   346 0.44   115 0.36
131 0.28     274 0.19   208 0.07   20260728 0.05
```

One owner now: `isInEntranceGateOpening(x, z, margin)` in `entrance/layout.ts`,
in metres, in the gate's own frame, and every point of a segment is tested, not
its midpoint. All nine clear. **No probe was widened and no seed dropped.**

**2. The railway — fixed here** (the section above). Different bug, different
collider (`halfThickness 0.18`), and the only one that *severed* the walk.

## What is left, named rather than waved at

After both fixes, every remaining blocked cell in the 7.00 m clear width has a
**negative overlap** — nothing is touching it. The blocker is the **soft play
boundary** (`GARDEN_PLAY_BOUNDARY`, which is `PARK_BOUNDARY` itself): the spline
is pinned to `ENTRANCE_WALL_RADIUS` at *one bearing* and is free to dip inside
it across the rest of the arch's ±4.1°, so the corners of the doorway read as
outside the park. Measured on seed 288, `edgeRadiusAt` runs 59.80 m at −0.06 rad
against 60.00 at the gate bearing.

**The mechanism it wants**, and it is small: `Collision.resolve` consumes the
clamp through `distanceToEdge` alone (plus a 0.25 m numeric gradient), so
wrapping `GARDEN_PLAY_BOUNDARY` — edge no nearer than the gate radius inside
`isInEntranceGateOpening` — fixes it without moving the spline, which is what
keeps every other park identical. **Not done here**: the gradient is normalised,
so a hard-edged override pushes a child *sideways* at the jamb, and getting the
taper right is a feelable, visible change to the player clamp at the front gate
that I cannot QA without a browser. It is a change to make with eyes on it.

## The one thing still red, on purpose

`check:coplanar` reports `MORE: garden|garden/path-kerb|garden/path-surface`,
5 facings against 1 recorded, on seed 288 — its bridges moved, so the drape
lifts different path stretches, so the two parallel ribbons share a plane at
more angles. Same area (3.9910 m²), same `fighting: false`. Root cause and the
real fix (delete the kerb's hidden face, ART_DIRECTION §7) are written up on
**#483**; not done here because it changes how every path is drawn and three
`grid-paths-*` branches own that file. The baseline entry was **not** bumped.

The other three coplanar findings were fixed at the root: `keyOf` had the
bridge's rail distance in the ratchet key, so one seam was recorded eleven
times and any moved loop read as NEW.

## After the in-flight branches land

- **`fix/torus-480` (PR #482)** adds `gateArch.ts` with
  `GATE_POST_COLLIDER_RADIUS` and its own gate clauses. No conflict expected —
  this branch touches neither `Entrance.ts` nor that file — but re-run
  `pnpm run check:gateway` once it merges, because the post colliders are what
  `gatewayWalk`'s control probes.
- **The authored replacement arch** widens the piers' keep-out to 0.80 m. That
  narrows the walkable opening, so re-run `check:gateway` and expect the
  corridor's blocked-cell counts to rise; the connected route is what matters.
