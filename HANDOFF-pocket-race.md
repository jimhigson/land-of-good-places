# HANDOFF pocket-race (fix/pocket-race, base origin/feat/procgen-on-sphere c190ba58)

Tasks: A seed 128 doormat/bridge reachability; B seed 3 race camera reversal; C seed 6 duck bar at 379.34 m.
Temp seed tests: test/procgen/seed-tmp{3,6,128}.test.ts (never commit). Logs in scratchpad/pocket-race/.

## Base reds on 3/6/128 (vitest, base c190ba58): 8 failed | 292 passed
- 128: doormat (anchor:dodgems 50.6,19.5; stall:dodgems 81.9,41.7; stall:facePaint 27.1,39.2), bridge deck (43.5,49.4) unreachable, coping stone (not mine)
- 6: duck bar 379.34 m 3.40 in/out; rainbow legs near path (not mine); coping (not mine)
- 3: camera -0.067 @334 m speed 0, 40/4800; sleepers 0.260 m (not mine; maybe #702)

## Findings

### A (seed 128) — ROOT CAUSE FOUND, not yet fixed
- Premise was wrong on this base: `LGP_SEED=128 pnpm run check:park` ALSO FAILS (route.unreachable 3:
  stall:dodgems, stall:facePaint, anchor:dodgems; poi.stranded 57). Both instruments agree. The one that
  disagrees is the layout-time probe ("every doormat reachable at layout time") and train/route.ts's
  `loopLeavesEveryDestinationOnTheCrossing` fill, which only knows rail fences + PARK_BOUNDARY.
- Geometry (scripts/tmp-pocket/map.mts, fill.mts COMPARE=1): the railway loop's interior (dodgems, facePaint)
  has one bridge (43.5,49.4) into a south rim strip (x 10..85, z 52..68). That strip joins the gate walk only
  through a neck beside the gate: rail fence (5.6,57.3)-(7.6,58.9) half .18 <-> gate arch east pier circle
  (4.3,60.0) r .80. Gap fence<->pier alone = 1.94 m clear (> 1.24 child). What seals it is the WELCOME SIGN:
  posts r .35 at (5.3,58.7) and (2.7,61.3), centre (4.0,60.0) = sitting on the arch pier. Gaps: fence<->post
  0.75, post<->pier 0.49, pier<->post 0.91 -> sealed. (describeNear via scripts/tmp-pocket/near.mts.)
  Gate is (0,60) on this seed; sign search box in `findWelcomeSignSpot` (Entrance.ts ~177) only checks
  track clearance; its corner candidate (dx=-3,dz=+4) = (4,60) is where it landed.
- Planned fix: `findWelcomeSignSpot` must also require each post clear of every existing collider by
  WALKABLE_GAP (collision.isClearCircle(post, POST_R + 2*PLAYER_RADIUS)) - an isolated obstacle with a child's
  width all round cannot disconnect anything. Garden wall, train fence and arch piers are all registered before
  the sign (World.ts order: Garden 124, ParkTrain 181, Entrance 286; piers registered just before the sign).
  Widen search / skip sign if nothing clears (backtrack, never seal). Secondary: route.ts fill should use
  wall keep (BOUNDARY_WALL_COLLISION_HALF+PLAYER_RADIUS; beware Garden import cycle - read lazily like parkPlan.ts
  wallKeep) - measured it does NOT change 128's verdict alone.
- Browser walk (scripts/tmp-pocket/walk.mjs, needs `vite` dev for window.game): key dirs measured
  Up(-.71,-.71) Right(.70,-.71) Down(.63,.77) Left(-.71,.71). Run died "execution context destroyed" (page
  navigated after spawn) - wait longer / re-read after navigation. Not yet completed.

### B (seed 3 camera) — diagnosis, not fixed
- measureZoomCeiling clamps ceiling to [1, unlimited]; at 334 m the RESTING rig (zoom 1, speed 0) reverses
  (-0.067), so the floor of 1 is what fails. Fix: allow ceiling < 1 where geometry demands (solve for
  FORWARD_MARGIN), with a floor; estimate needed zoom ~0.80 there. Canonical resting worst is 0.094 (<0.15
  FORWARD_MARGIN) so a single-margin change would also zoom canonical in slightly at its hairpins - visible,
  needs before/after frames. Experiment script scripts/tmp-pocket/ceil.mts (was using env CF in camera.ts,
  reverted; result never read).
- PR #702 does not touch camera.ts or route.tangentAt used by camera/physics (only rail sampler/sleepers/carts).

### C (seed 6 duck bar 379.34 m, 3.40 m/s in and out) — not started. 3.40 m/s looks like a speed floor.

Other base reds on these seeds NOT mine: 128/6 coping stones, 6 rainbow legs near path, 3 sleepers 0.260 m.
scripts/tmp-pocket/ is diagnostics - delete before PR.
