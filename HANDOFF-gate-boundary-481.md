# #481 — the park's front doorway is walled shut on some seeds

Branch `fix/gate-boundary-481`, off `origin/main` at `bd818210`.

## The issue's diagnosis is wrong, and it matters

#481 says *"the boundary wall runs across the gateway"*. Measured on the built
park, it does not. The boundary wall's collision segments carry
`halfThickness 0.45` and on both cited seeds they stop cleanly either side of
the gap, exactly as `Garden.ts`'s `inGateGap` intends:

- seed 288: nearest boundary segments end at `(4.47, 59.65)` and `(-3.48, 60.44)`
- seed 18: nearest boundary segments end at `(5.03, 59.93)` and `(-4.93, 60.51)`

**What actually shuts the door is the park railway** — `train/fence.ts`'s
lineside fence (`halfThickness 0.18`) and its track escort
(`halfThickness = TRACK_CLEARANCE = 1.3`):

```
seed 288  fence   (2.64, 57.73) -> (0.01, 57.76) -> (-2.59, 57.41)   half 0.18
          escort  (2.47, 55.74) -> (0.13, 55.77) -> (-2.18, 55.46)   half 1.30
seed  18  fence  (-1.13, 59.87) -> (1.43, 58.85)                      half 0.18
          escort (-1.68, 57.94) -> (0.51, 57.07)                      half 1.30
```

Seed 18's fence runs *through the arch itself*, 0.4 m inside the gate line.

## Why

`train/route.ts`'s `trainObstacles()` is the obstacle field the loop is grown
against. It knows the layout's plots, the Sky Cruiser's low corridor and the
cruiser's **dismount point** — that last one added because "a fence across the
spot a ride sets a child down is the seed-18 failure shape". It does **not**
know the park's own front door. So the loop is free to run across it, the
fence seals, and `crossings.ts` mints no gap there because `paths.ts`'s gate
corridor now hands the walk to the street lattice.

Meanwhile `ENTRANCE_CLEAR_X/Z/RADIUS` in `entrance/layout.ts` already declares
a 10 m gate-plaza keep-out — and only `Scenery.ts` reads it. Trees are kept off
the forecourt; the railway is not. That is the two-definitions disease with one
of the two definitions simply missing a reader.

## Second hand-copy found in passing

`src/world/parkLayout.ts:140-141`:

```ts
const GATE_ANGLE = Math.PI / 2; // matches entrance/layout.ts ENTRANCE_ANGLE
const GATE_RADIUS = 60; //         matches ENTRANCE_WALL_RADIUS
```

A comment promising two numbers agree. Fixed by importing.

## Status

- [x] measured, cause found
- [ ] forecourt keep-out read by the railway
- [ ] `check:gateway` over the whole pool, proved red on 288 first
