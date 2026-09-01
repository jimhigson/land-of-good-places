# HANDOFF — castle lift has no lift to stand in (#450)

Branch `fix/castle-lift-car`, worktree `.claude/worktrees/castle-lift`.
Dev server port **5515** (`--strictPort`).

## Root cause (confirmed by reading, to be confirmed on screen)

The castle lift is **already** a portal lift with the same two-method seam as
the hotel's (`LiftRide` in `src/world/building/liftRide.ts` vs `HotelLift` in
`src/world/hotel/HotelLift.ts`). The *logic* is not the bug.

The bug is that **nothing is drawn in the castle's lift alcove**. `GlassLift`
was deleted with #377/#380 and nothing replaced it. Concretely:

- `Shell.ts` cuts a gap in the east wall of every deck between
  `LIFT_DOOR_MIN_Z = 3.5` and `LIFT_DOOR_MAX_Z = 6.5` (3.0 m).
- `layout.ts` still declares `LIFT_SHAFT` (x from `INTERIOR_HALF_X` to
  `INTERIOR_HALF_X + 3.4`, z 3.3–6.7) and `LIFT_CAR_X = INTERIOR_HALF_X + 1.7`.
- The deck slab only extends to `INTERIOR_HALF_X + HALF_WALL`. So the car spot
  is **beyond the floor plate, in open air**, with no car, no doors, no ceiling.
- `LiftRide` glides her out through the hole to `LIFT_CAR_X`. She floats.

Second, smaller defect found on the way: while aboard she is posed facing
`Math.PI/2` (= **+X**, into the back of the shaft). The castle's alcove is on
the **east** wall, so "out of the doors" is **−X** = `-Math.PI/2`. The hotel's
alcove is on the west wall, where `Math.PI/2` is correct — the number was
copied without mirroring it.

## The hotel's lift, and what is reusable

`Hotel.fitLiftAlcove` (Hotel.ts ~3293) builds four authored assets from
`src/art/models/hotelAssets.ts` and `Hotel.updateDoors` (~3378) drives them:

- `createLiftCar()` — 2.2 × 2.2 m inside, 2.5 m ceiling, open front, handrail.
  Floor plate top at exactly y = 0.
- `createLiftFrame()` — 3.28 m architrave plugging the wall gap + brass sill.
- `createLiftDoors()` — two sliding leaves, `setOpen(0..1)`.
- `createLiftDial()` — pointer indicator, `setSweep(0..1)`, blank UV face
  painted by `paintDialFace` (Hotel.ts ~6392).

Geometry fits the castle almost exactly: hotel car sits `1.72` m behind the
wall, castle's `LIFT_CAR_X` is `1.70` m past it; hotel gap 3.2 m vs castle
3.0 m, so the 3.28 m frame plugs it with more overlap, not less.

## Plan

1. Extract `src/world/lift/LiftAlcove.ts` — the car/frame/doors/dial assembly,
   its dial painting, and the offsets — used by **both** hotel and castle.
2. Extract `src/world/lift/phases.ts` — the shared `LiftPhase` union, the
   `COMING_SECONDS`/`STEP_SECONDS` timings and `doorOpenness(phase, t)`.
   `HotelLift` had `doorOpenness`; `LiftRide` did not.
3. `LiftRide` gains `doorOpenness()` / `activeFloor()` / `dialSweep()`.
4. `Building.ts` builds one `LiftAlcove` per floor group at the east wall and
   drives it each frame; plus an alcove floor slab over `LIFT_SHAFT` so there
   is no gap between the deck edge and the car's own plate.
5. Fix the aboard facing.

## Status

- [x] root cause
- [ ] shared module
- [ ] castle wiring
- [ ] checks
- [ ] ridden in the browser on every floor pairing
