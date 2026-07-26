# PROGRESS — the park train (branch `feat/park-train`)

Handoff file. Deleted when the PR is opened.

## Checkpoint 1 — route plan (done)

### The problem

"A closed loop around the edge of the park, outside the attractions, inside the
boundary" is a tighter brief than it sounds. Measured from `world/anchors.ts`,
`world/building/layout.ts` and `core/constants.ts`:

| Obstacle | Radial band it occupies | Bearings (atan2(z,x)) |
| --- | --- | --- |
| dodgems plot (rect ±12×10 @ 33,21) | 23.7 – 54.6 | 13.7° – 55.9° |
| waterFight plot (rect ±12×11 @ -31,25) | 23.6 – 56.1 | 117.8° – 161.9° |
| building **shell** (rect ±12×9 @ -28.5,-30.5) | 27.1 – 56.6 | 208° – 247° |
| ferrisWheel plot (circle r11 @ 31,-27) | 30.1 – 52.1 | 303.4° – 334.4° |
| ball pit (circle r6.4 @ -9,-15) | 11.1 – 23.9 | 213.6° – 264.4° |
| pink boundary wall | inner face at 59.55 | all |

Consequences:

- **Inside everything is impossible.** The ball pit occupies r 11–23.9 on the
  south-west bearings while the building starts at 27.1 there; the only inner
  corridor is 2–6 m wide and coincides with the main path ring. A loop that
  threads it is not "around the edge of the park" either.
- **The building's *plot rect* cannot be honoured.** Its corner (-46,-44) is at
  r = 63.7 — outside the boundary wall itself. `Building` hides that placeholder
  (`setPlaceholderVisible('building', false)`), so the real obstacle is the shell,
  and the shell is what the route respects. Same for the ball pit (r 6.4 built,
  not the 7.5 plot marker).
- **Outside everything fits, but only just.** Between the building's SW corner
  (r 56.6) and the wall (59.55) there is a 2.95 m gap. The train is 1.5 m wide.

### The route

`src/world/train/route.ts` **solves** for the loop at boot rather than hard-coding
control points, in the same spirit as the NPC waypoint graph validating its own
edges against the finished collision world:

1. Cast a ray from the park centre at each of 360 bearings; the outer exit radius
   of every obstacle gives `lo(θ)`, the smallest radius that clears the plots.
   `hi(θ)` is the wall's inner face less the same clearance.
2. Relax a radius profile between those bounds — Laplacian smoothing, a gentle
   pull towards a nominal 48 m, plus a Euclidean repair step (radial clamping
   alone leaves the track too close to plot *corners*).
3. Nudge the result off anything the collision world knows about — trees and
   bushes — by probing `CollisionWorld.resolve()` as a query. Only done where
   r < 56, because `Scenery` plants nothing past r = 55 and `resolve()` also
   applies the `GARDEN_PLAY_RADIUS` clamp, which would fight the wall-hugging
   sections.

Solved shape (checked offline, `scratchpad/route3.mjs`):

- length **327 m**, radius **48.1 – 57.8 m**
- worst clearance to any plot/wall **1.30 m** (train half-width 0.75 m)
- tightest bend **~3.1 m** radius, at the three plot corners it hooks around
  (140° waterFight, 224° building, 34° dodgems) — unavoidable, the wall is
  1.3 m behind the train at those points
- it crosses **no path**: the path network tops out at r ≈ 37 (spur-building)
  and the train never comes inside r = 48

### Stations

The profile is at its nominal minimum on the two free east/west bearings, so the
stations go at **(48.4, 0) "Sunny Side"** and **(-48.3, 0) "Bluebell Halt"** —
genuinely opposite ends, both on a near-circular (r ≈ 48) stretch so a straight
platform sits flush against the track.

## Checkpoint 2 — build

- [ ] `src/world/train/` — route, track, locomotive + carriages, stations, system
- [ ] player riding (seat-lock, like SlideRide)
- [ ] NPC riders (additive block in `wanderDriver.ts`)
- [ ] whistle / bell / chuff, night lights
- [ ] World.ts wiring block
- [ ] build green, browser verification, screenshots
