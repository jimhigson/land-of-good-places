# HANDOFF — bridge clearance fix (agent `e-bridge-fix`)

Fixing the one blocking finding on PR #220 (`feat/railway-bridges`). Everything
else on that PR was approved and must not be disturbed.

**Worktree:** `.claude/worktrees/e-bridge-fix`, local branch `e-bridge-fix`,
pushes to `feat/railway-bridges`. (The branch was already checked out in the
abandoned `.claude/worktrees/railway-bridges`, so a same-name worktree was
impossible; `e-bridge-fix` tracks `origin/feat/railway-bridges` and is pushed
to it explicitly. `npm ci` run inside.)

## The finding, confirmed

`LOCO_TOP_Y` is documented as "the tallest point of the whole train" and "the
number anything built over the railway has to clear". It is neither — it is the
funnel tip only, and the train carries passengers taller than the funnel.

Verified in code:

- `ParkTrain.carryPassengers` → `this.seatPosition(seat, 0, ...)`, so a **standing
  NPC rider's feet are at `CAR_FLOOR_Y` = 0.58**. The comment is explicit:
  "Children stand in front of the bench rather than sitting on it".
- `ParkTrain.updateRider` → `seatPosition(seat, SEAT_Y - CAR_FLOOR_Y, ...)`, so the
  **player's feet are at `SEAT_Y` = 1.0**. `Player.setRidePose` only does
  `position.set` / `rotation` — **no seated fold**, so she rides at full height.

## The number nobody had: children are much taller than `KID_HEIGHT`

`KID_HEIGHT` = 2.12 is only the *default* style. Measured with `visibleTop` over
every `HAIR_STYLES` entry and every `HAT_KINDS` entry, attached exactly the way
`WornHat`/`NpcSystem` attach them (`hatAnchor.add(hat.root)` at natural scale;
the shop catalogue's `model()` is a bare `createHat(kind)`):

| what | height |
|---|---|
| bare, tallest hair (mohican) | 2.490 |
| party hat (on bunches) | **2.968** |
| bobble 2.816 · puff 2.778 · ripikaHat 2.759 · crown 2.681 · cap 2.499 | |

**Tallest child = 2.968 m**, i.e. `KID_HEIGHT + 0.848`. Hair alone (the reviewer's
"roughly 0.2 m") is *not* the whole story — hats dominate, and children ride
wearing them.

## What that makes the real clearance

| | m |
|---|---|
| `LOCO_TOP_Y` (funnel tip) | 2.420 |
| standing NPC: `CAR_FLOOR_Y` + tallest child | 3.548 |
| player on seat: `SEAT_Y` + tallest child | **3.968** |

So the tallest travelling point is **3.968 m**, dominated by the player, not the
locomotive. Today's `BRIDGE_RISE` = 2.77 puts the soffit at 2.42 — **1.55 m inside
the player's head.**

NPC scale (`rng.range(0.86, 1.04)` in `NpcSystem`) does not change the winner: a
standing NPC's feet are 0.42 m below a seated player's, which more than covers
the 4 % (0.12 m) an NPC can be scaled up by. Noted in the doc rather than
imported.

Precedent that this is not absurd: `check-rail-race.mts` already requires
`RAIL_OVER_RAIL = 5.5` m of air where the rail-race ring flies over the railway
(Decision 4). 3.968 sits comfortably under that, so the two are consistent.

## Plan

1. New `src/world/train/clearance.ts` — the single owner of the derivation.
   Imports `CAR_FLOOR_Y`/`SEAT_Y` from `trainModel.ts` and the child height from
   `kid.ts`. Nothing hand-copied.
2. Rename `LOCO_TOP_Y` → `LOCO_BODY_TOP_Y`, doc rewritten to describe the
   locomotive body only and to point at `clearance.ts` for the real number.
3. `check-park.mts`'s `BRIDGE_RISE` derives from the new value.
4. New procgen invariant measuring the built park, proved red first.

`kid.ts` imports fine from a `check:` script under `--experimental-transform-types`
(probed) — issue #226 does not bite here.

## Status

- [x] Finding confirmed and quantified
- [] Implementation
- [ ] Red proof of the new invariant
- [ ] build + test:procgen green
- [ ] pushed, PR description updated, review comment answered
