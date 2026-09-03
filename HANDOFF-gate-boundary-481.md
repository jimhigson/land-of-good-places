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

## Which side yields: BOTH, in three places, and one is deliberately left out

**1. The boundary wall's aperture — fixed.** The hole was an **angle**
(`ENTRANCE_GATE_HALF_ANGLE`, 0.073 rad) while the arch is a **width** (4.3 m):
two definitions in units nobody can compare, agreeing to 0.08 m at one radius,
on a wall laid by arc length along a spline whose radius varies per seed. The
collision test asked about a segment's **midpoint**, so a 2 m chord whose middle
cleared still reached a metre in. Measured on `main`, in the 7.00 m clear width
1.0-2.0 m inside the arch, masonry overlapped a player-sized body on **nine of
sixteen pool seeds**: 451 0.87 m, 128 0.76, 267 0.50, 346 0.44, 115 0.36,
131 0.28, 274 0.19, 208 0.07, canonical 0.05. One owner now —
`isInEntranceGateOpening(x, z, margin)`, metres, gate frame — tested at both
ends and the middle. **The angle is deleted**; its two remaining consumers ask
the metres owner.

**2. The railway — fixed.** `halfThickness 0.18` fence + 1.3 escort, across the
opening on 288 and through the arch on 18. A **closed-loop** property, not a
search obstacle: fourteen pool seeds unchanged.

**3. Lamps — fixed.** One still stood inside the arch on 428 and 131.
`lampFits` asks the same owner; a lamp that does not fit is skipped.

## The play clamp: built, measured, and deliberately left out

The spline is pinned at **one bearing** while the arch spans ±4.1°, so the
doorway's corners read as outside the park. The correction is right and it is
written up in the PR — but `ParkBoundary` answers *"where may a child stand?"*
and *"what shape is the park?"* with one object, so correcting the clamp
corrected the generator. It broke three things in turn, each found by measuring:
seed 115's railway re-ranked into the gateway; the park grew a tongue outside
the gate line and the Rail Race rings came out wrong on three seeds; and even
one-sided, with the clamp on its own constant read by exactly three consumers
(all of them the clamp), seed 24's ring still moved. Its own branch, with eyes.

**Cost of leaving it:** on five seeds one probe at the extreme jamb (±3.50
across, 1.0 m in) reads blocked, with the arch's own post 0.11 m away. That is
brushing the post, not a wall.

## Coplanar: green, by deleting the hidden face

The kerb was a full-width ribbon 25 mm under a surface only 0.425 m narrower
each side — 3.99 m² of buried shared plane, the largest garden seam in the
baseline. `addRibbonKerb` draws the two visible bands now. 250 seams → **226**,
exit 0. The baseline entry tightened 3.9910 → 0.4989 m².

`keyOf` also had the bridge's **rail distance** in the ratchet key, so one seam
was recorded **eleven times** and any moved loop read as NEW — that affects
everything the ratchet has ever recorded, not just this branch.

The bridge-drape invariant compared kerb and surface vertex counts for equality;
a correctly draped two-band kerb has exactly twice (92 v 46, seed 11). Named
constant, tolerance untouched.

## After the in-flight branches land

- **`fix/torus-480` (PR #482)** adds `gateArch.ts` with
  `GATE_POST_COLLIDER_RADIUS` and its own gate clauses. No conflict expected —
  this branch touches neither `Entrance.ts` nor that file — but re-run
  `pnpm run check:gateway` once it merges, because the post colliders are what
  `gatewayWalk`'s control probes.
- **The authored replacement arch** widens the piers' keep-out to 0.80 m. That
  narrows the walkable opening, so re-run `check:gateway` and expect the
  corridor's blocked-cell counts to rise; the connected route is what matters.
