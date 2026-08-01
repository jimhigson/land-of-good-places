# NPCs ride the rides when the player is not aboard

## The ask

"While not on a ride, the player should see NPCs ride the rides, using the
same mechanics as would propel the player along; just like how the train goes
round even if the player is not on it."

## What shipped

**Rail Race** (`src/world/railRace/RailRace.ts`) — the smallest gap, as
predicted. The three rivals (`RIVALS`, with real kid meshes from
`createKid`) already existed and already used the same `stepRider` physics
the player's own cart uses, but `driveRiders()` — the thing that steps them —
was only called from the `'racing'`/`'finishing'` phase cases. The rest of
the time (`phase === 'waiting'`, which is the default and where the ride
returns to after every race) nothing stepped them at all: they sat frozen at
the start line.

Fix: added `driveIdleRivals()`, called from the `'waiting'` case in
`update()`. It drives only the non-player carts (the player's own cart has
nobody in it and stays parked until `requestBoard()`) through the exact same
`stepRider`/`rivalWantsHold` functions a real race uses. The one wrinkle:
`stepRider` marks a rider `finished` at the two-lap mark and then refuses to
step it further (`if (rider.finished) return NOTHING`). A real race wants
that — a finish line and a result card. Idle looping does not, so on
`rider.finished` the code wraps `travelled` back into lap one and rewinds the
hazard cursors (`barCursor`, `zoneCursor`) to match, then leaves speed/holding
alone so the join is seamless rather than a stop-start. `requestBoard()` and
`arrive()` already reset every rider (`Object.assign(cart.rider,
createRider(...))`) when a real race starts or ends, so boarding/leaving
transitions in and out of idle-looping for free — no new state needed there.

Everything downstream (placement, kid pose animation, spark emission for
carts on a black stretch) already iterated over `this.carts` unconditionally
in `placeCarts()`/`animate()`, outside the phase switch — so the idle rivals
just start being visibly driven, animated, and sparking correctly with no
further changes.

`RIDE_SCALE` (the 2.5x cart/rider/rail scale-up) is applied once in
`buildCarts()` to each cart's `group.scale`; `driveIdleRivals` never touches
`group.scale`, so it stays compatible untouched.

Verified: `npm run build` (real exit code checked, not piped through
head/tail) — passes, including `check:rail-race` (unaffected: it drives
`stepRider` directly against a fresh `createRider`, not through
`RailRace.ts`) and every other pre-build check. No procgen files touched, so
no `test/procgen/invariants.ts` change needed.

## Survey of the other rides

- **Train** (`src/world/train/`) — reference pattern, already correct.
  `ParkTrain.update()` always calls `drive()` regardless of whether anyone is
  aboard; passengers are optional. No change needed.

- **Sky Cruiser / coaster** (`src/world/coaster/Coaster.ts`) — sits idle at
  the station when nobody is riding (`phase === 'waiting'`), same shape of
  gap as the rail race. But it has **zero existing "someone else is riding"
  concept**: one cart, one seat, no kid mesh, no second-rider infrastructure
  anywhere (confirmed nothing outside `world/World.ts` even references
  `Coaster`). Closing this gap means designing and building a new NPC-rider
  presence from scratch (at minimum: a kid model in the cart, deciding when
  it's "occupied" vs the player's own boarding swapping it out) rather than
  reusing an existing pattern. Per the scope call, left as a follow-up rather
  than implemented here.

- **Space Ferris Wheel** (`src/minigames/ferrisWheel/`) — turns out **not** to
  be under `src/world/rail/`; it's `minigames/ferrisWheel/`. Two halves:
  - The **exterior landmark prop** (`wheelProp.ts`, wired into
    `world/AnchorPlots.ts`) already turns continuously in the park regardless
    of whether the player is riding — `AnchorPlots` calls
    `this.ferrisWheel?.update(dt, elapsed)` unconditionally, same shape as the
    train. No gap here. But its twelve gondolas are drawn as `InstancedMesh`
    shells with no rider figures modelled in them at all — there's nothing to
    animate as "an NPC riding" even if there were a gap.
  - The actual **ride** (`SpaceFerrisWheel.ts` + `friends.ts`, `gondola.ts`,
    `space.ts`, ~3,500 lines total) is a self-contained mini-game in its own
    teleported-to scene, not a `GameSystem` ticked by `World` alongside the
    walkable park. It has no architectural relationship to the
    train/coaster/rail-race pattern this task is about. Treating it the same
    way would mean redesigning that minigame's own boot sequence, not
    reusing anything. Left undocumented in depth and out of scope — flagging
    only that it exists and looks nothing like the other three.

- **Dodgems** (`src/minigames/dodgems/`) and **Water Fight**
  (`src/minigames/waterFight/`) — also self-contained teleported minigames,
  not part of the walkable park world, and not really "ride the ride
  passively" mechanics (they're competitive minigames: bumper cars, water
  balloons). Same reasoning as the Ferris Wheel applies: out of scope, no
  existing "someone else is playing this while you're not" concept, and not
  what the family's framing ("just like how the train goes round") was
  describing.

## Bottom line for review

Only the rail race was touched, as the task's scope call intended. The other
three park rides fall into two buckets: the train and the Ferris wheel's
exterior prop already satisfy "loops without the player" (nothing to do);
the coaster, the Ferris wheel's actual ride, dodgems and water fight would
each need new NPC-rider infrastructure or a different architecture entirely,
which is a bigger lift than "cheap reuse of an existing pattern" and is
better scoped as its own follow-up ticket per ride.
