# HANDOFF — E3-slide — GitHub #118, ginormous slide on the rail generator

Branch `feat/slide-on-rail-generator`, worktree `.claude/worktrees/slide`, dev port **5312**.

## Root cause of #118 (measured, not inferred — do not lose this)

The slide is **twelve hand-authored absolute world coordinates** in
`buildGinormousSlide()` (`src/world/building/Building.ts`, ~line 815). The castle
moves per seed — `BUILDING_CENTRE_X/Z` derives from `placedEntry('building')`
nudged by `BUILDING_CENTRE_NUDGE` — but the slide's numbers do not move with it.
The `gardenRoot` offset subtracts `BUILDING_CENTRE_*` and then adds it straight
back, so those twelve numbers are literal absolute world positions.

On the canonical seed, **8 of the 12 points are inside the castle footprint**
(`|localX| <= 12 && |localZ| <= 9`), including both the first and the last. The
final point lands at facade-local (4.54, 6.99) — past `ENTRANCE_MAX_X = 4`, i.e.
behind a solid south wall segment. That is why a child is boxed in.

Three separate faults, all worth fixing together:

1. absolute coordinates against a per-seed castle position;
2. the start is not at the slide door (curve starts at facade-local x −3.66; the
   facade slide door is x 7.4…11.6);
3. it never reaches the ball pit — 22.07 m short — despite the park manifest
   giving the pit a `near: { id: 'building', min: 24, max: 30 }` relation whose
   stated purpose is that the pit stays within a slide's reach, and
   `anchors.ts` giving the pit the sign subtitle "the ginormous slide lands here!".

## Measured site geometry (canonical seed 20260728)

```
castle centre      (-15.34, -21.79)   half extents 12.00 x 9.00   base Y 0.44
TOP_DECK 4         deckY = 14.84      floor height 3.60
facade slide door  local x 7.4..11.6 on the south wall (local z = +9)
door centre world  (-5.84, -12.79)    terrain -0.07
ball pit           ( 6.94, -27.93)    pit radius 6, plot bounding radius 9
terrain at pit     0.19
door -> pit        19.81 m            drop 14.84 -> ~1.19 = 13.65 m
```

**`clearOfPlots` rejects every point on the door→pit line, and every point on a
ring around the pit.** That is not a bug: the castle's plot bounding radius is 19
and the pit's is 9, their centres are 23.11 m apart, so the two bounding circles
overlap. A slide whose entire job is to join those two plots can never satisfy
the standard predicate. **The slide's `clear` predicate must exempt exactly the
two plots it deliberately joins (`building`, `ballPit`) and honour every other.**

Second consequence: a straight door→pit run is 19.8 m for a 13.65 m drop — a 44°
plunge. The route has to swoop out and back to earn a rideable gradient. Target
roughly 55–70 m of track.

## The generator could not do open curves at all

`RouteBrief.closed` existed but `solved = true` was set in exactly one place,
inside `if (brief.closed && ...)`, so an open brief burned every start pose and
threw. There was no end-pose concept — the closer aimed hard-coded at
`startPose` in three places — and `pickKind` had no `closed` guard, so past 45%
of `desiredLength` an open route was steered back to its own start (`scoreOf`
had the guard; `pickKind` did not; they disagreed).

Fixed additively: `RouteBrief` is now a discriminated union on `closed`.
`closed: true` keeps its exact fields and its exact code path — the Sky Cruiser
does not move. `closed: false` requires `endPoses`, and the search aims its
approach corridor and its analytic biarc finisher at the end pose instead of the
start. Overseer ruling: E3 owns `generate.ts` this week; E4-castle-window's
additive `gate` field lands on top of this.

## Coordination with E4-castle-window

E4 is putting the Sky Cruiser through the castle courtyard, West wall to East
wall, at roughly cruise height. My slide leaves the castle at the **south** wall
roof parapet (world (-5.84, -12.79), y 14.84) heading +z, away from the castle,
and never enters the courtyard. The risk is only where the cruiser leaves the
East wall and the slide sweeps east toward the pit. Handled structurally rather
than by negotiation: the slide's `clear` predicate keeps `RAIL_OVER_RAIL` (5.5 m,
Decision 4's rail-over-rail air) from the cruiser centre line wherever the two
are within that in height, so whatever route E4 lands, the slide stays off it.

## Status

- [x] Root cause found and measured
- [ ] Generator open-curve support (own commit, pushed first — E4 is waiting)
- [ ] Slide plan module + exit node + paths.ts registration
- [ ] First-person RideCamera; grown-up in front, lying down
- [ ] Procgen invariants
