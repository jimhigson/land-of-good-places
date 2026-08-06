# HANDOFF — bridge clearance fix (agent `e-bridge-fix`)

**Status: done.** The one blocking finding on PR #220 is fixed, built, tested and
pushed. Everything else on that PR was approved and was not disturbed.

**Worktree:** `.claude/worktrees/e-bridge-fix`, local branch `e-bridge-fix`,
pushed to `feat/railway-bridges`. (The branch was already checked out in the
abandoned `.claude/worktrees/railway-bridges`, so a same-name worktree was
impossible; `e-bridge-fix` tracks `origin/feat/railway-bridges` and is pushed to
it explicitly. `npm ci` run inside. **Do not** work in `railway-bridges` — it is
now behind.)

## The finding, confirmed

`LOCO_TOP_Y` was documented as "the tallest point of the whole train" and "the
number anything built over the railway has to clear". It was neither — the funnel
tip only, on a train that carries passengers taller than the funnel.

- `ParkTrain.carryPassengers` → `seatPosition(seat, 0, …)`: a **standing** NPC
  rider's feet are at `CAR_FLOOR_Y` = 0.58. The comment is explicit.
- `ParkTrain.updateRider` → `seatPosition(seat, SEAT_Y - CAR_FLOOR_Y, …)`, and
  `Player.setRidePose` only sets position/rotation — **no seated fold**. The
  player's feet are at `SEAT_Y` = 1.0 and she rides at full height.

## The number nobody had: children are much taller than `KID_HEIGHT`

`KID_HEIGHT` = 2.12 is only the *default* style. Measured with `visibleTop` over
every `HAIR_STYLES` × `HAT_KINDS` combination, attached the way `WornHat` and
`NpcSystem.buildIndividualAvatar` attach them (the shop catalogue's `model()` is
a bare `createHat(kind)`):

| what | m |
|---|---|
| bare, tallest hair (mohican) | 2.490 |
| **party hat (on bunches)** | **2.968** |
| bobble 2.816 · puff 2.778 · ripikaHat 2.759 · crown 2.681 · cap 2.499 | |

**Hats, not hair, dominate** — `KID_HEIGHT + 0.85`. The reviewer's "spiky hair
adds roughly 0.2 m" was right but was not the worst case.

## The derivation now

| | m |
|---|---|
| `LOCO_BODY_TOP_Y` (funnel tip) | 2.42 |
| `CAR_FLOOR_Y` + tallest child (standing NPC) | 3.55 |
| **`SEAT_Y` + tallest child (player — the winner)** | **3.97** |
| + `RIDER_HEADROOM` | **4.37** |
| `BRIDGE_RISE` = that + `BRIDGE_DECK_DEPTH` 0.35 | **4.72** |

`RIDER_HEADROOM` = 0.4 is **measured, not picked**: `WornHat.update` pops a hat in
at `1 + sin(pop·π)·0.35`, so it is briefly drawn at 1.35× — worth **0.346 m** on
the tallest hat. Rounded up for daylight.

NPC scale (`rng.range(0.86, 1.04)`) does not change the winner: a standing NPC's
feet are 0.42 m below the player's on the bench, more than the 4 % (0.12 m) an
NPC can be scaled up by.

Consistent with `check-rail-race.mts`'s `RAIL_OVER_RAIL = 5.5` (Decision 4).

## What changed

- **`src/world/train/clearance.ts`** (new) — the single owner. Imports every
  term; nothing hand-copied.
- **`src/world/train/trainDimensions.ts`** (new) — leaf module, no imports,
  holding `CAR_FLOOR_Y` / `SEAT_Y` / `LOCO_BODY_TOP_Y`. Issue #226's shape:
  three floats that `check-park.mts` and `test/procgen/` should be able to read
  without loading three.js and the track builder. `trainModel.ts` re-exports all
  three so no existing importer changed.

  **I first documented this as fixing a live seed-ordering bug. It does not, and
  review was right to catch it.** `trainModel.ts` does *not* reach `parkManifest`
  at runtime — `track.ts` imports `TrainRoute` with `import type`, which is
  erased. Verified two ways: importing `trainModel.ts` then setting `LGP_SEED`
  then importing `parkManifest` yields the late seed; and review pointed the
  invariant's import back at `trainModel.ts` and got 132 passed, nothing skipped.
  Had it been real it would also have been loud, not silent — `buildParkFacts`
  asserts `PARK_SEED === seed`. The leaf module stays as defence against that
  chain becoming real (one `import type` → value import restores it, with no
  warning), but the comments now say *plausible*, not *demonstrated*.
- **`LOCO_TOP_Y` → `LOCO_BODY_TOP_Y`**, re-documented as bodywork only.
- **`TALLEST_CHILD_HEIGHT` = 2.97** in `kid.ts`, beside `KID_HEIGHT`.
- **`check-park.mts`**: `BRIDGE_RISE = TRAIN_CLEARANCE_Y + BRIDGE_DECK_DEPTH`.
- **Decision 8** records the derivation and the carry-forward consequences.
- **`test/procgen/invariants.ts`**: new invariant, "the clearance over the
  railway covers the train and everyone riding it".

## The red proofs (done before believing it)

Clearance reverted to the funnel-only value:

> TRAIN_CLEARANCE_Y is 2.42 m but the train sweeps to 3.97 m — anything built to
> that clearance sits **1.55 m inside it**. Worst: built train-locomotive 2.38,
> standing NPC rider 3.55, player on the bench 3.97 (bunches hair + party hat)

`TALLEST_CHILD_HEIGHT` set back to `KID_HEIGHT`:

> TALLEST_CHILD_HEIGHT is 2.12 m but a real bunches hair + party hat measures
> **2.968 m**

Both reverted; green again.

## Verification

- `npm run build` — **exit 0**, unpiped. `check:park` green: 15/15 attractions,
  0 rail crossings, 72/72 waypoints, same 5 recorded deviations as before.
- `npm run test:procgen` — **exit 0**, **132 passed / 8 files**, up from 127.
  Exactly +5 = one invariant × five seeds. **Zero skipped.**

## The one thing the next agent should weigh (#116)

**A 4.72 m deck is high for a park bridge, and the reason is that nobody on the
train sits down.** The player's feet are 0.42 m above a standing NPC's and
`setRidePose` folds nothing, which is what takes the requirement to 3.97 before
headroom.

**Correcting a figure I got wrong first time round** (caught in review, and it
was relayed onwards before it was checked): sitting the *player* alone buys
**0.42 m, not ~0.9 m**. The moment she folds, the standing NPC rider at
`CAR_FLOOR_Y + 2.97 = 3.55 m` becomes binding and the rise only drops
**4.72 → 4.30**. The full saving needs the **NPCs to sit too**, and
`carryPassengers` stands them deliberately — *"a standing child holding on reads
better than a walking one sitting down."*

So the question for the family is not "should the player sit" but **"should
everyone on the train sit"**, which reverses an art choice on a ride mostly seen
from outside. That is a **design change**, not a constant to shave.

**It must be settled before #116 builds deck geometry.** Ramp length, gradient
and footprint all derive from the rise, so a pose change afterwards invalidates
every deck already placed — the rework ORDER-OF-WORK.md exists to prevent. The
constant is safe either way (every term imported, invariant re-measures); the
geometry on top is what is expensive to redo. Recorded in Decision 8 in these
terms.
