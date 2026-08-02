# HANDOFF — Rail Race: two independently-built rings

Branch `feat/railrace-two-ring`, worktree `.claude/worktrees/railrace-two-ring`.

**Status: complete, build green, PR raised.** Everything below is the record of
why it is shaped the way it is.

## The bug

Jim's phone screenshot, 2 Aug 2026: flying past the rail race on the jetpack,
a rival NPC mid-lap rendered ~2.5x the size of the (not riding, nearer the
camera) player.

**Root cause, confirmed.** `RailRace.buildCarts()` ran once, from the
constructor, and did `group.scale.setScalar(RIDE_SCALE)` (2.5, `route.ts`) on
every rival's cart+kid group *permanently*. Only the player's own body model
(`player.model.root.scale`) was toggled between 1 and `RIDE_SCALE`, in
`requestBoard()` / `arrive()`. Since PR #152 the rivals idle-ride the ring
continuously as ambient park life, so their carts and riders were giant to
anyone who walked or flew past, race or no race.

The rails were the same story: `track.ts`'s `RAIL_GAUGE = 0.62 * RIDE_SCALE`,
`BAR_HALF_SPAN`, the rail tube radius and every duck-bar dimension baked
`RIDE_SCALE` in at build time. The whole ride was permanently at toy scale.

## What shipped

Two rings, built independently at park load, both outside the boundary wall:

- **walk-past ring**, `scale = 1`, group `railRace:walk-past-ring`. Rivals
  idle-ride it permanently. Always visible; its trestle legs are the only
  colliders the ride registers.
- **race ring**, `scale = RIDE_SCALE`, group `railRace:race-ring`. Visible only
  between `requestBoard()` and `arrive()`. Registers no colliders at all.

`RailRaceRoute` takes a scale and owns `laneSpacing` / `laneRadii` / `laneSpan`.
`buildRailRaceTrack(route, layout, collision, options)` derives gauge, duck-bar
span and clearance, trestle beam span and every cross-section from the ring it
is building. **There is no `.scale` on any ring geometry anywhere**, and an
invariant now says so.

## The five decisions, and the reasoning

### 1. Concentric rings that swap — NOT side by side

This is the one place the implementation departs from Jim's sketch, and the
reason is arithmetic:

- Wall (`ENTRANCE_WALL_RADIUS`) at 60 m. The race ring is four lanes at 2.6 m
  spacing plus a 1.55 m gauge = **9.35 m of radial width on its own**; the
  walk-past ring adds 3.74 m; with a gap, ~15 m side by side.
- Standing them side by side puts the outer ring's nominal radius past ~72 m.
  That is a 452 m lap against the 336 m the race was tuned on, the terrain disc
  has to grow from 72 m to ~88 m, and — the real killer — the two rings would no
  longer share an arc length, so `HAZARD_LAYOUT`, `RACE_DISTANCE`, every
  schedule and the rider `travelled` remap all become a second set of numbers to
  keep in step.
- They are **never both live**, so side-by-side buys no clearance whatsoever.

So both rings share one nominal radius (65.5 m), one arc length, one start
distance and one undulation. Boarding is an iris wipe, so the swap is never
seen; it reads as "the ring I'm on just got huge", which is the effect Jim
described. Mutual exclusion lives in exactly one method, `setActiveRing`.

### 2. Rivals relocate; there is only ever one set of them

The same three `Cart` objects (same `Rider`, same `KidHandle`) are re-pointed at
the other ring's route and re-scaled. `travelled` carries across untouched
because both rings share `length` and `startDistance`. There is no second set of
rivals to fall out of sync, so no way to end up with two Pips.

### 3. The race ring registers no colliders at all

`CollisionWorld` has no per-collider removal — only `clear()` — so "unregister
the hidden ring" is not available. It is also not needed: nobody walks during a
race. The one ring that is there while you are on foot is the one ring that is
solid, so an invisible-but-solid rail has nowhere to live. Asserted.

### 4. Hills belong to the route, sizes belong to the ring

Both rings run the identical undulation, so `stepRider` physics and the whole
hazard schedule are shared verbatim. Only lane spacing, rail gauge, duck-bar
size, trestle cross-sections and cart scale differ. In `track.ts` the rule is:
anything written as `X * RIDE_SCALE` became `X * ringScale`; anything written as
a bare number was authored looking at the race ring, so it became
`X * ringSizeVsRace` (1 on the race ring — so the race ring is bit-identical to
before). **Vertical clearances deliberately do not scale**: a park-scale child
on the walk-past ring needs her head height under the arch just as much.

### 5. The hilltop apron was extended so the rings stand on level ground

`RIM_START` 61 → 72, `RIM_END` 71 → 82, `TERRAIN_RADIUS` 72 → 83.5, plus a new
`TREELINE_INNER_RADIUS` (71.5) replacing `GARDEN_HALF_SIZE + 1` in
`Scenery.buildTreeline`. Three usages in total.

Without it the ring's outer rail at 70.2 m sat on a 60° hillside (16 m trestle
legs) and the treeline, which ran 63–70.5 m, grew straight through the track.
The drop itself is unchanged in height and steepness, so it still hides itself
from the 38° camera; the treeline count went 340 → 540 because its annulus grew
~60 % and a thin treeline is one you can see the edge of the world through.

## Numbers, as built

```
loop        411.5 m at r=65.5, 4 lanes          (was 336.2 m at r=53.5)
race ring   rails r=60.8-70.2   lane span 7.80 m
walk-past   rails r=63.6-67.4   lane span 3.12 m   (exactly 1/2.5)
plays well  34.4 s   mashes through everything 68.1 s   (budget: >20 s, <105 s)
```

## Verification

- `npm run build` — **exit 0** (checked directly, not through a pipe).
- `npm run test:procgen` — 85/85 across the canonical seed and four sweep seeds.
- `npm run check:park` — green; `rail.exclusion` re-recorded 20 → 21 with the
  reason written into the RATCHET entry (a rail-race trestle leg had been the
  only solid thing beside one metre of railway, by accident, and has left).
- `npm run check:wall-tunnelling` — exit 0.
- The new invariant was verified **non-vacuous** by reintroducing both bugs in
  turn: a permanent cart scale (caught, 4 complaints) and a race-ring collider
  (caught).

## Still needs a human eye

No browser — the shared Chrome profile was not assigned, so this is
build-and-invariant verified only. Listed in the PR body. The things a screen
would answer that arithmetic cannot: how the ride reads from inside the park now
the apron is 11 m wider, whether the walk-past ring's park-scale carts look
right, and whether the race ring's camera (now standing at r≈91, off the terrain
disc) frames the park the way it did.

## Notes for whoever picks this up

- `npm run check:rail-race` prints the lap length, both rings' rail extents and
  the five strategy race times. Re-run after **any** radius change — the
  `< 105 s` / `> 20 s` assertions there are the real budget.
- `node_modules` is not shared between worktrees; `npm ci` first.
- Never work in `/Users/jim/dev/landOfGoodPlaces` itself.
