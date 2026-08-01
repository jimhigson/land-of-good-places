# Rail Race cart upgrade — handoff

Branch: `rail-cart-upgrade`, worktree `.claude/worktrees/rail-cart-upgrade`.

## The ask

Jim: "get the 3d artist to make a better mine cart type car with actual
headlights that work, wheels that turn, wheels spaced to fit on the rails,
and a seat and space for the character and one pet to ride with them, then
apply this. each rider's cart should match the colour of their rails."

## What shipped

- New file `src/world/railRace/cart.ts` — `createCart(colour)` returns a
  `CartHandle { root, spinWheels(travelled), dispose() }`. Replaces the old
  two-box `buildCart()` that used to live at the bottom of `RailRace.ts`.
  - **Headlights**: two small emissive spheres (`fairyWarm`, toon material
    with `emissive`) on the nose — same "glow reads as lit" trick the dodgem
    car's spark/star use. No dynamic `PointLight`: up to four carts are on
    screen at once over trestle-heavy scenery and it wasn't worth the cost
    for a glow that reads the same without one (explicitly a nice-to-have,
    not required, per the brief).
  - **Wheels that turn**: four cylinders, `spinWheels(travelled)` sets each
    wheel's angle to `-travelled / WHEEL_RADIUS` — an **absolute** angle off
    `Rider.travelled`, not an accumulated per-frame delta, so a fresh race
    (which resets `travelled` to 0) resets the wheels too, with no drift.
    Same "lay the cylinder on its side once, then drive `rotation.y`" idiom
    as `minigames/dodgems/car.ts`'s wheels — copied deliberately, it's the
    park's one other example of a turning wheel and it already works.
  - **Wheel spacing**: `WHEEL_HALF_GAUGE = RAIL_GAUGE / RIDE_SCALE / 2`,
    derived from `track.ts`'s `RAIL_GAUGE` rather than a second hand-picked
    number — `RAIL_GAUGE` is already in world (post-`RIDE_SCALE`) metres, so
    it's divided back down to the cart's own natural scale before use.
  - **Seat + pet space**: a rider's bench (centred at `x=0`, matching where
    `RailRace.ts` actually seats the kid/player — this matters, see below)
    plus a smaller pet perch beside it with its own small backrest and a
    heart-shaped mark (reusing `art/style/shapes.ts`'s `heartGeometry`, the
    same shape `backpacks.ts` already uses for "a pet belongs here"). See
    "Pet seating" below for why nothing is actually *sat* in that perch yet.
  - The cart is built at natural (pre-`RIDE_SCALE`) size; `RailRace.ts`'s
    `buildCarts()` still applies `group.scale.setScalar(RIDE_SCALE)`
    externally, unchanged — no second scale baked into `cart.ts`.
  - `CartHandle.dispose()` frees its geometries/materials; `RailRace.dispose()`
    now calls it (the old `buildCart()` never got a matching disposal path at
    all — minor pre-existing leak, fixed as a side effect).

- **Colour-match bug fixed**: `track.ts`'s `LANE_COLOURS` array (which paints
  the rails) is now hoisted out of `buildRailRaceTrack` to module scope and
  exported. `RailRace.ts`'s `buildCarts()` derives every cart's colour from
  `LANE_COLOURS[lane]` instead of a second, hand-maintained colour:
  - The three `RIVALS` entries had a `cart` field that had drifted out of
    step with their actual lane's rail colour (Pip/lane 0 was `markerLemon`
    instead of `markerPink`, etc — all three were wrong). That field is now
    gone entirely; there is nothing left to drift.
  - The player's cart was hardcoded to `PALETTE.markerPink` regardless of
    lane; it now uses `LANE_COLOURS[PLAYER_LANE]` (`markerMint`), matching
    her actual rail.
  - `outfit` (what a rival wears) is untouched — that's a separate, correct
    choice, not tied to the rail.

## Pet seating — investigated, not fully wired

Checked for ride-specific "pet rides too" precedent on the train
(`world/train/`) and the coaster/Sky Cruiser (`world/coaster/Coaster.ts`):
neither has one. There is no existing "seat a specific pet in a ride vehicle"
mechanism anywhere in the park.

What *does* exist, and already works here for free: `entities/parade/BackpackPeek.ts`.
Every kid model built by `createKid()` carries a backpack by default, and
`BackpackPeek` makes whichever pet/toy she owns climb out and have a look
around every few seconds — driven entirely off `player.model.backpackAnchor`,
a child of her own body, updated every frame by `Parade.update()` with no
riding-state check anywhere. Since the player's actual model (not a copy) is
what's posed into the cart by `poseRider()`, her backpack and its peeking
pet keep working, completely unmodified, while she's riding the Rail Race —
exactly as they do everywhere else in the park. So "a pet accompanies her"
is **already true** for the player, today, with zero new code.

What is *not* there: an actual pet character sitting in the cart's pet perch,
distinct from the backpack-peek gag. Building that would mean picking which
of her owned pets is "the one riding" (parade members don't have a concept
of an "active"/"equipped" one — they're just a queue of up to 8 followers),
spawning a seated pose for it, and tearing it down cleanly at dismount —
real new integration work, not a model change, and risky to rush into a
system (`RailRace.ts`) that already has a lot of moving parts. Per the
brief's own allowance, I built the physical space (the pet perch geometry)
and left it empty rather than rush that wiring. If the family wants a real
seated pet next, the perch position is `(-0.34, 0.44, -0.2)` in the cart's
own (pre-`RIDE_SCALE`) local space — that's the anchor point to hang a
future pet model from.

## Build / test status

- `npx tsc --noEmit`: clean.
- `npm run build` (the full chain: text/spacing/fit checks, tsc, asset/hair/
  crowd/ride-camera/orientation/waypoint/park/jitter/rail-race/tie-frame/
  cruiser checks, then `vite build`): **exit 0**, no errors, log saved at
  `/tmp/rail-cart-build.log` on the machine this ran on.
- `npm run test:procgen`: kicked off; check its result before merging if this
  handoff is picked up mid-run — nothing in `test/procgen/invariants.ts`
  measures the Rail Race cart today (checked: no `cart`/`Cart` hits in that
  file or `scripts/check-rail-race.mts`), so this change shouldn't be able to
  fail it, but it wasn't run to completion by the time this was written.

## Visual QA — not done

Did not have the shared Chrome profile (no Overseer sign-off to drive it).
**Needs a human/agent-with-browser-access to check:**
- Cart silhouette reads as a mine cart, not a floating box, at Rail Race
  camera distance (`RaceCamera`, side-on, over trestles).
- Headlamp glow is visible on the nose without looking like a stray dot.
- Wheels visibly spin as a cart accelerates/decelerates, and look attached to
  (not floating off) the rails at `RAIL_GAUGE`.
- Player's own cart is mint (matches her rail); rivals' carts match theirs
  (pink lane 0 / Pip, sky lane 1... wait, check actual index-to-name mapping
  in `RIVALS` order against `LANE_COLOURS` — Pip is index 0 → `markerPink`,
  Nell index 1 → `markerSky`, Otto index 2 → `markerLemon`, player →
  `markerMint`).
- Backpack peek still visible on the player while riding (should already
  work — worth a sanity check since nothing like this was checked before).
- Pet perch doesn't clip through the kid/player model or look like an
  unexplained bump.

## Files touched

- `src/world/railRace/cart.ts` — new.
- `src/world/railRace/RailRace.ts` — swapped `buildCart()` for `createCart()`,
  fixed cart colour to derive from `LANE_COLOURS[lane]`, added per-frame
  `spinWheels`, added `cart.dispose()` in `RailRace.dispose()`, removed the
  now-dead `cart` field from `RIVALS`.
- `src/world/railRace/track.ts` — hoisted `LANE_COLOURS` to module scope and
  exported it.
