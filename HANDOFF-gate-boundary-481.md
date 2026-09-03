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
- [ ] `pnpm run check` — running
- [ ] PR
