# Handoff — the pet slides down behind her (#468)

Branch `feat/pet-rides-the-slide`, worktree `.claude/worktrees/pet-slide`.

## What was built

- **`src/world/slide/petRiders.ts`** (new) — owns where a companion rides:
  `petSeatOnSlide(slide, riderDistance, slot, seat)` puts the slot-th one
  `PET_SLIDE_LEAD` (1.5 m) + `slot * PET_SLIDE_GAP` (1.2 m) back along the
  ride's own curve, turned to the tangent and pitched to the slope. Also now
  the single owner of `slopeOf`, which moved out of `Building.ts` (the child,
  the grown-up and the pets all take the chute's pitch from one place).
  Declares `PetSlideLink`, the same one-way seam as the banquet's
  `PetTableLink`.
- **`ParadeMember.rideSlide/leaveSlide/onSlide`** — the seat is written
  straight onto the body (not the follow spring: at 6.5 m/s a spring lags and
  cuts corners, which on a corkscrew means a pet outside the trough). `position`
  is kept level with what is drawn, so the bottom is a hand-back, not a teleport.
- **`Parade.ridePetsDownSlide/callPetsOffSlide/petsOnSlide/companionAt`**.
- **`Building.advanceRide`** calls `ridePetsDownSlide(this.petSeat)` every giant
  frame; `finishRide` calls `callPetsOffSlide()`.

**Not a second follower** — this retargets inside `Parade`, exactly as
#449/#453 did for the pets' table.

## Before the lip

The line runs on **backwards** along the entry tangent rather than clamping to
t=0, or eight animals stand inside one another at the entry for 1.5 s. That
stretch is inside the castle's own geometry.

## The instrument

`pnpm run check:pet-slide` — rides the real loop with a real Parade of three
species and asserts every ridden frame. **It has a control**: the same descent
with `building.petParade` never set (the game before #468) must fail, and does
— 9.57 m off the chute, pets 0.00 m apart, in 0% of 336 chase frames.

Green run: 675 ridden frames, ≤0.11 m off the chute, closest pair 1.17 m,
biggest single-frame step 0.120 m, framed on **100%** of 336 chase frames, back
within 4.2 m of her 3 s later.

## State

- `tsc` 0, `check:pet-slide` 0. Full `check` / `build` / `test:procgen` running.
- Added `check:pet-slide` to the `check` chain: step sets compared against
  `origin/main` — 55 -> 56, nothing dropped.
- TODO: browser QA on port 5581 (`/slide`), mid-descent screenshots, PR.
