# HANDOFF — Rail Race: two independently-built rings

Branch `feat/railrace-two-ring`, worktree `.claude/worktrees/railrace-two-ring`.

## The bug

Jim's phone screenshot, 2 Aug 2026: flying past the rail race on the jetpack,
a rival NPC mid-lap rendered ~2.5x the size of the (not riding, nearer the
camera) player.

**Root cause, confirmed.** `RailRace.buildCarts()` runs once, from the
constructor, and does `group.scale.setScalar(RIDE_SCALE)` (2.5, `route.ts`) on
every rival's cart+kid group *permanently*. Only the player's own body model
(`player.model.root.scale`) is toggled between 1 and `RIDE_SCALE`, in
`requestBoard()` / `arrive()`. Since PR #152 the rivals idle-ride the ring
continuously as ambient park life, so their carts and riders are giant to
anyone who walks or flies past, race or no race.

The rails are the same story: `track.ts`'s `RAIL_GAUGE = 0.62 * RIDE_SCALE`,
`BAR_HALF_SPAN`, the rail tube radius and every duck-bar dimension bake
`RIDE_SCALE` in at build time. The whole ride is permanently at toy scale.

## The agreed design (Jim, 2 Aug — implement, do not redesign)

Two rings, built independently at load, both **outside the boundary wall**:

- **walk-past ring** — park scale (scale 1). Rivals idle-ride it permanently.
  Always visible, colliders registered once at build.
- **race ring** — toy scale (`RIDE_SCALE` = 2.5). Visible only between
  `requestBoard()` and `arrive()`.
- Rails are *generated* per ring at that ring's own real dimensions, never one
  geometry with a `.scale` multiply on the group.
- Cart/kid models may keep a scale multiply (that is not the bug).

## Implementation decisions taken here (record for the PR)

### 1. Concentric rings that swap, not two rings side by side

Jim's sketch had the two rings *next to* each other. **It does not fit, and the
reason is measurable:**

- Boundary wall (`ENTRANCE_WALL_RADIUS`) is at 60 m. Terrain disc ends at
  `TERRAIN_RADIUS` = 72 m and the rim falls `RIM_DROP` = 17 m between 61 m and
  71 m. The treeline band that hides the terrain cut sits at 63–70.5 m.
  So the usable apron outside the wall is ~9 m wide, most of it already
  spoken for.
- The race ring is 4 lanes at 2.6 m spacing plus a 1.55 m gauge = **9.35 m of
  radial width on its own**. The walk-past ring adds 3.74 m, plus a gap:
  ~15 m side by side.
- Pushing the outer ring far enough out to fit them side by side puts its
  nominal radius past ~70 m. That lengthens a lap from 336 m to 440 m+, and
  `scripts/check-rail-race.mts` asserts *"even the worst run takes < 105 s"*.
  A 30 %+ longer lap blows that ceiling and re-tunes the whole race.

So: **both rings share one nominal radius and one arc length; exactly one is
ever live.** Nothing is lost — they are never both visible, so side-by-side
would buy no clearance and cost a race re-tune plus a much bigger terrain
change. Boarding is an iris wipe, so the swap is never seen; it reads as
"the ring I'm on just got huge", which is the effect Jim described.

### 2. Rivals relocate; there is only ever one set of them

The same `Cart` objects (same `Rider`, same `KidHandle`) are re-pointed at the
other ring's route and re-scaled. No second set of rivals, so no way to end up
with two zombie copies. `travelled` is interchangeable because both rings share
`length`, `startDistance` and the identical undulation — only lane *spread* and
built gauge differ.

### 3. The race ring registers no colliders at all

`CollisionWorld` has no per-collider removal (only `clear()`), so "unregister
the hidden ring" is not available. It is also not needed: nobody walks during a
race. The walk-past ring registers its trestle circles once, permanently; the
race ring registers none. There is therefore no state in which an invisible
rail is solid — the classic bug this could have had.

### 4. Hills are a property of the route, not of the ring's scale

Both rings run the identical undulation (same harmonics, same amplitudes, same
arc length), so `stepRider` physics, `HAZARD_LAYOUT` and every schedule are
shared verbatim. Only lane spacing, rail gauge, duck-bar size, trestle beam
span and cart scale differ.

### 5. The hilltop apron is extended so both rings stand on level ground

`RIM_START` / `RIM_END` / `TERRAIN_RADIUS` are used in exactly three places
(`terrain.ts`, `Garden.ts`'s mesh, `Scenery.ts`'s treeline band), so this is a
contained change. Pushing the crest out gives the rings level ground to stand
on outside the wall — which is the whole point of Jim's "outside the park there
is no clutter to fight" reasoning — and moves the treeline beyond them so it
still screens the terrain cut.

## Status

- [x] Root cause confirmed
- [x] Design decided (above)
- [ ] `route.ts` parameterised by ring
- [ ] `track.ts` parameterised by ring
- [ ] `RailRace.ts` two rings + swap
- [ ] terrain apron / treeline
- [ ] procgen invariant
- [ ] `npm run build`, `npm run test:procgen`
- [ ] PR

## Notes for whoever picks this up

- Baseline before touching anything: `npm run check:rail-race` prints the lap
  length and the five strategy race times. Re-run after any radius change —
  the `< 105 s` and `> 20 s` assertions there are the real budget.
- Never work in `/Users/jim/dev/landOfGoodPlaces` itself.
