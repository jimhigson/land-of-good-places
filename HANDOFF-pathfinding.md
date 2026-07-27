# Handoff — 1.0 Route finding (tap-to-move must go *round* things)

Branch `player-pathfinding`, worktree `.claude/worktrees/player-pathfinding`,
off `origin/main` at 3c3bef0.

## The decision, and why

**Chosen: a navigation *grid*, generated at run time from the finished
collision world.** New file `src/world/NavGrid.ts`.

The three candidates, and why the other two lost:

1. **Reuse `entities/npc/poiGraph.ts` as-is — rejected.** Its edges are
   validated against the real world (which is the good part, and this borrows
   the trick), but its *nodes* are forty-odd hand-authored seeds along the ring
   road and the plaza. Decision 4 replans the entire park around a railway and
   explicitly plans to hand-add spurs and platform nodes to that file — so its
   node set is days from being rewritten. Worse, it is far too coarse for a
   finger: a child taps a specific patch of grass, and snapping her destination
   to the nearest of forty waypoints, or walking her out to the ring road to
   get four metres round a bench, is a different bug wearing the first one's
   coat. It also has only three nodes inside the building.
2. **Densify the poiGraph — rejected.** Densifying it into something fine
   enough for arbitrary taps means generating its nodes, at which point it is a
   lattice with extra steps, and it still leaves the NPC seeds as a
   hand-authored layer to maintain.
3. **A polygonal navmesh — impossible as things stand.** There is no walkable
   geometry to build one from. The floor of this world is a *function* —
   `WalkSurfaces.sample()` — and the meshes are only its portrait (see
   `world/pickWalkable.ts`, which makes the same point about raycasting).
   Anything that wants to know where you can stand has to ask, point by point.

So: ask, point by point, on a 0.5 m lattice, from the two authorities that
already decide where a character may stand — `CollisionWorld` for the solid
things (every collider stamped in, fattened by the walker's radius) and the
ground sampler for the height of each free cell (so a route never steps up
something unwalkable nor off the edge of a deck). Then A* + string-pulling.

**Why this survives the two pending decisions.** It is derived, never authored:
the railway's exclusion walls, the moved attractions and anything else built
later appear in it for free. It never assumes one continuous interior — the
lattice covers exactly the current soft play bounds (`setPlayBounds`, which is
what already changes on a space change) and is rebuilt when those bounds move,
when the walker's height moves by half a storey, or when the collision world's
`revision` changes. Floors at far-apart origins are therefore just "the bounds
moved".

## What happens when the target is unreachable

Three layers, all of them "walk as close as you can and stop":

- A* keeps the reachable cell that got **closest** to the goal, so an
  unreachable destination yields a route to the nearest place she can actually
  stand. `NavGrid.lastRouteReachedGoal` says which happened.
- `TapNavigator` then pulls the destination (and the tap marker) back to that
  point when it is more than `SHORTFALL_TOLERANCE` short, and drops the
  interact zone — she will not reach the thing, so its button must not fire.
  Within the tolerance the true target is kept, which is what makes a stand
  point tucked against a stall still work.
- The old stuck timer survives as the backstop, now measured against the
  current leg, with **one** replan attempt before it gives up.

If there is no lattice covering where she is standing at all, `findRoute`
returns 0 and `TapNavigator` falls back to the straight-line seek it has always
done — never worse than today.

## Auto-hop

A wall she hops without being asked is **not an obstacle** and is not stamped
into the lattice, so routes go straight over the low garden walls exactly as
they should. The hop test is not duplicated: `Collision.ts` exports one
`autoHopClears(topHeight, apexClearance)` used by `resolve`, by
`wouldAutoHopClear` and by the lattice builder, and `Player` exports the one
`JUMP_APEX_HEIGHT` all three are fed. Nothing about the fling bug (item 1.4) is
touched either way.

## No per-frame cost

The lattice is built lazily on the first route asked for in a space; a route is
planned **once per tap** and then followed. Every buffer is allocated once per
lattice and reused. Per frame a routed walk costs one extra distance check and
allocates nothing.

## Measured

Headless harness against the real `NavGrid` + `CollisionWorld` (park-sized
bounds, 1400 circles, 120 walls, a heightfield):

| | |
|---|---|
| first route in a space (lattice build **and** A*) | 3.3 ms |
| any later route, lattice cached | 1.2 ms average, 3.3 ms worst |
| a completely hopeless goal | 0.1 ms |
| worst smoothed route, corner to corner | 28 waypoints |
| per frame while walking | one extra distance check, no allocation |

Behaviours verified headlessly: open ground stays a single straight waypoint
landing exactly on the tap; a wall with a doorway is routed through the
doorway; a goal sealed inside a box reports `lastRouteReachedGoal === false`
and stops 4.3 m short, outside the box; a 0.95 m `autoHoppable` wall is walked
straight over (one waypoint) while the same wall at 2.3 m is routed round; a
3 m drop is never crossed except over its bridge.

## State — done

- [x] `src/world/NavGrid.ts`
- [x] `Collision.ts` read-only accessors, play-bounds getters, `revision`,
      shared `autoHopClears`
- [x] `Player.ts` exports `JUMP_APEX_HEIGHT`
- [x] `TapNavigator.ts` follows a route
- [x] `Game.ts` builds the grid and hands it over
- [x] `npm run build` green (exit 0)
- [x] PR raised

## Browser QA — done (27 Jul, I owned the browser)

The Overseer's PR-57 failure ("she walks east and stops 25 m short, x tracks
the target but z does not") **was a probe bug, not a product bug**, and is
resolved. `TapNavigator.navigateTo(x, y, z)` takes **y second**; it was being
called as `navigateTo(0, 30)`, so z was never passed, and three.js's
`Vector3.set` deliberately keeps the old `z` when handed `undefined`. Verified
directly: `navigateTo(0, 30)` leaves the target at **(3.75, y, 3.75)** — goal
(0, 0) is inside the fountain ring, so the router correctly pulled it back to
the nearest reachable point on the rim at z ≈ 3.75. That is exactly the z ≈
3.5–5.2 every trace ended at, and it is self-perpetuating: each walk leaves her
at z ≈ 4, which becomes the next call's stale z. Called correctly as
`navigateTo(0, y, 30)` she walks the route through both intermediate waypoints
and arrives at (−0.3, 29.8).

The blocked lattice cells at (0, 4) are the **fountain rim**, correctly
stamped. Probing along x rather than z shows a ring, not a band: at x = 0 the
cells at z = −5, −4 and z = 3, 4 are blocked with free cells between them.

**Does routing actually fix getting stuck?** Eight fixed trips across the park,
run twice — once normally, once with `findRoute` stubbed to 0 so the walk falls
back to main's straight-line seek:

| | arrived within 1 m | worst miss |
|---|---|---|
| routed | **7/8** | 1.13 m |
| straight line (main today) | 5/8 | **28 m** |

The two catastrophic straight-line failures (28 m and 25.3 m short — the exact
complaint the family reported) become 0.41 m and 0.25 m.

Also verified in the running game: a real `handleTap` routes (3 waypoints round
the fountain); double-tap still holds sprint; a scripted walk is not routed
(`routeLength` 0); tapping the middle of the fountain pulls the target back to
the rim, drops the interact zone, stops her at (3.5, 4.0) with **residual speed
0** — no jitter, no running on the spot.

Timings in the real park (424 colliders): first route in a space, including
building the lattice, **6.8–10.1 ms** — a one-off on the first tap, inside a
single 60 fps frame. Warm routes **1.13 ms** average, 6.1 ms worst. Frame times
while walking a route: 8.3 ms median, 9.8 ms worst. Console clean.

## Item 1.4, the jump-over-wall fling — diagnosed here, deliberately NOT fixed

The one remaining imperfect trip is item 1.4, and I can now characterise it
exactly. Handing this to whoever owns 1.4 rather than fixing it here.

**Repro:** walk from (18, 1) to (26, 3). There is an `autoHoppable` wall at
x = 22 (z −6 → 4, top 1.2 m). Peak speed **26–28 m/s** against a walking speed
of 7.4 and a sprint of 11.1, every time.

**It is pre-existing and this PR does not worsen its magnitude** — measured
with routing 26.1 m/s, with routing stubbed out (main's behaviour) 27.8 m/s.
This PR does make it fire **more often in ordinary play**, because routes now
deliberately cross hoppable walls instead of detouring round them, which is the
correct behaviour and was an explicit requirement.

**Root cause.** The speed peaks at x = **22.96**, which is exactly
`22 + halfThickness 0.34 + PLAYER_RADIUS 0.62` — the surface of the dilated
collider, i.e. the moment of depenetration. As a descending jumper's
`hopClearance` falls back below the wall's `topHeight`, the wall becomes solid
again while she is still inside its footprint, and `resolve` ejects her
sideways. `Collision.resolve` corrects an overlap **fully and in one frame**
whenever it is under `SHALLOW_OVERLAP` (0.5 m), and only sets `escorting` for
overlaps *deeper* than that — so `Player.update`'s

```ts
if (dt > 0 && !escorting) this.velocity.x = (this.position.x - this.previousPosition.x) / dt;
```

banks the ejection as velocity. A 0.4 m correction at 60 fps is 24 m/s, which
is the observed number. Design feedback #17's fix closed the *deep* path only;
this is the same bug through the shallow path, where the correction is not
opposing her motion but ejecting her sideways.

**Suggested shape of a fix (untested, for 1.4's owner):** depenetration must
never *increase* speed. Clamping the derived velocity's magnitude to the
pre-collision velocity's magnitude fixes the launch while leaving
walking-into-a-wall (where the correction reduces speed) exactly as crisp as it
is now. That is a three-line change in `Player.update` and it is 1.4's call to
make, not this PR's.

## Earlier list — needs visual QA

1. Tap across the park behind a tree line: she should walk round, not stop.
2. Tap over a **low garden wall**: she must hop it, not detour. (The most
   likely place for this to be wrong.)
3. Tap the far side of the fountain.
4. Double-tap a routed destination: still runs the whole way.
5. Park map: press a location — routed now, same as a tap.
6. Tap somewhere unreachable: marker should sit where she actually stops, and
   she should stop cleanly rather than jitter.
7. Stairs and the front door still ride normally (scripted walks are not
   routed — if this broke, it is the `scripted` test in `navigateTo`).
8. Inside the castle: tapping across a deck hole should route round it.
