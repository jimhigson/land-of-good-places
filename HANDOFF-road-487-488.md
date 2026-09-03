# Handoff — the road outside the gate (#487 road ends + grey, #488 bus clips the rail race supports)

Branch `fix/road-487-488`, worktree `.claude/worktrees/road-487-488`.
**Not finished.** Read "What is left" at the bottom before doing anything.

## The measurement that decided everything

`scripts/measure-entrance-road.mts` (sweep with `LGP_SEED=<n>`; run under
`node --no-warnings --import ./scripts/ts-extension-resolver-register.mjs`).

**All sixteen pool seeds had rail-race trestle legs inside the bus's swept
body** — 2 to 8 per seed, worst lateral intrusion 0.54–2.51 m. Structural, not
luck on Jim's park:

| seed | legs in bus sweep | legs in road footprint | worst intrusion (m) |
|---|---|---|---|
| 20260728 | 6 | 8 | 2.51 |
| 5 | 6 | 6 | 1.59 |
| 11 | 6 | 6 | 2.47 |
| 24 | 2 | 5 | 0.54 |
| 115 | 6 | 8 | 1.38 |
| 128 | 2 | 6 | 2.32 |
| 131 | 8 | 8 | 2.14 |
| 208 | 8 | 8 | 2.26 |
| 225 | 8 | 8 | 2.50 |
| 267 | 5 | 8 | 1.10 |
| 274 | 4 | 5 | 1.70 |
| 288 | 6 | 8 | 2.37 |
| 326 | 2 | 2 | 2.43 |
| 346 | 3 | 6 | 2.36 |
| 428 | 8 | 8 | 2.46 |
| 451 | 2 | 2 | 2.15 |

### The impossibility proof (why the road alone cannot fix it)

Everything outside the wall is measured as **outset** — metres beyond
`PARK_BOUNDARY`'s own edge, the unit `route.ts`, `terrain.ts` and `ringPath.ts`
already use.

- Trestle feet stand at `NOMINAL_OUTSET` = **6.5**, all the way round, on every
  seed (measured, and stated in `route.ts`, whose doc boxes it into
  `[6.15, 6.92]` — inner so the innermost rail clears the masonry, outer so the
  outermost stays inside `RIM_OUTSET_START`). It cannot move.
- A `2 * ROAD_HALF_WIDTH` = **7.78 m** road needs its centre at outset ≥ 3.89 to
  stay out of the park and ≤ 8.11 to stay off the 17 m hillside → **[3.89, 8.11]**.
- To clear a leg at 6.5 that centre must be ≥ **4.4 m** away → outset ≤ 2.1 or
  ≥ 10.9.

**The bands do not intersect.** No road running *along* the wall clears a
support at any offset, straight or curved. A road *crossing* the trestle line is
fine — `TRESTLE_SPACING` is 12 m against a 7.78 m road.

Overseer's ruling (3 September): the ride's placement search **must** treat the
road as a corridor, exactly as `groundIsClear` already treats paths, the rail
corridor and `PARK_LAYOUT.entries`. The road was simply missing from that list.

## What is done and pushed

1. **Grey (#487 part 2).** Cherry-picked `647ea7c5`, `9347f62d` from the
   cancelled `origin/fix/grey-arrival-paving`. `roadMaterial()` gains a tone;
   the park asks for `'grey'`, `BusJourney.ts` (the intro ride's own `Scene`,
   the only other call site) takes the sand default, so the intro is untouched
   by construction rather than by promise.
2. **`src/world/entrance/roadRoute.ts` — the road's one owner.** The centre line
   is the park's edge pushed out along its normal by `ENTRANCE_ROAD_OUTSET`
   (4.49 m — `ROAD_HALF_WIDTH` plus the masonry's reach, i.e. as close to the
   wall as a road can be laid, because every metre further out is a metre of the
   ride's apron taken). It runs `ENTRANCE_ROAD_KERB_HALF_RUN` (= `CAT_BUS_LENGTH`,
   15.8 m) each way, then two tails turn away from the park and climb to
   `ENTRANCE_ROAD_TAIL_OUTSET` (= `TERRAIN_APRON`, 23.5 m), over the hilltop's
   brow to the terrain disc's own cut edge. Verified shape,
   `scripts/probe-road.mts`:
   ```
   road outset 4.49 -> 23.50, kerb half run 15.8, extent -40.8..41.1
       at        x        z   outset   groundY
      -16   -15.86    65.76     4.50      0.27
        0    -0.08    64.56     4.49     -0.20
       16    15.07    69.65     4.50     -0.40
       26    18.27    78.89    12.16     -0.47
       30    18.98    82.83    15.69     -5.69
       40    22.78    91.86    23.32    -17.41
   ```
   It goes over the brow (outset 12, `RIM_OUTSET_START`) at about 26 m from the
   gate and is out of sight past that.
3. **`railRace/track.ts`'s `groundIsClear` honours the corridor** —
   `isInEntranceRoad(x, z, POST_FOOT_RADIUS)`. `World.ts` builds `RailRace`
   before `Entrance` and the corridor is derived from the boundary alone, so the
   ordering works. `pnpm run check:rail-race` **exit 0** with it in.
4. **A real regression found and root-caused**, not absorbed: `test:procgen` went
   red on five seeds, all on *"only the walk-past one is solid"*. Cause was **not**
   the ride — it was the invariant. `track.ts`'s `strut` composes a leg's matrix
   about the *midpoint* of foot-to-top and registers the collider at the **foot**;
   the invariant asked about the midpoint. On a leg that leans (a nudged spot with
   its branch tops still under the rails) those are different places — measured
   drift up to **2.00 m** — so bigger nudges made four solid legs read as hollow.
   Control (`scripts/probe-leg-lean.mts`, canonical seed): of 100 legs, **50 have
   no collider under the foot (the whole race ring, which registers none) and 50
   do (the whole walk-past ring)** — the test still separates the rings exactly as
   written, and asking about the foot is strictly stronger than asking about the
   midpoint. After the fix: `test:procgen` **exit 0, 515 passed**.

## The check exists now, and it is honestly red

`pnpm run check:entrance-road` (in the `check` chain — added and verified by
**parsing** `package.json`'s `scripts` and diffing the step *sets*: nothing
dropped, one added).

It does three things, and the order matters:

1. **The control, first and every run.** It sweeps the road as it *used* to be —
   the straight chord at the wall plus nine metres — and requires that to come
   back dirty. Latest run: **96 legs across 16 seeds, worst 3.30 m inside a
   bus**. If that ever reads clean the instrument is blind and the whole run is
   declared void rather than passing.
2. **The sweep.** The bus's own oriented footprint, stepped at 0.25 m from the
   brow at +26.2 m to −26.2 m, against every trestle leg in the built park
   (resolved to each leg's **foot**, with the ring's own scaled foot radius).
   **0 hits on all sixteen seeds.**
3. **Plan versus park.** Every vertex of every drawn `entrance-road*` mesh must
   lie inside the corridor the sweep measured. **This is currently RED** — 63 to
   113 vertices per seed, up to 6.43 m out — and it is red on purpose: without
   it, the file would report a clean sweep of a *route* while the game still
   drew and drove the old straight kerb. That is exactly "an assertion reporting
   success about something it is not describing", and this clause is what stops
   it. It goes green when step 1 of "What is left" below is done.

Two findings from building it, both worth keeping:

- **The corridor is the swept body, not the ribbon.** Testing width alone
  (`ROAD_HALF_WIDTH`) still left the bus through 1–3 legs on every seed: a
  `CAT_BUS_LENGTH` rigid box on a road that turns overhangs the kerb. The
  corridor is now the union of a bus-length, road-width box at every sample.
- **Sample the corridor finer than anything that measures it.** At the 1 m
  station spacing the union of boxes misses the bulge *between* samples, and two
  seeds kept a leg 0.18 and 0.22 m inside the bus. `CORRIDOR_SAMPLE_SPACING` is
  0.2 m. Same disease as CLAUDE.md's "a gap you cannot walk into at 5 cm a step
  you may still tunnel into", inside out.
- **The keep-out must use the ring's *scaled* foot radius**, not bare
  `POST_FOOT_RADIUS` — the walk-past ring's legs are fatter than the constant,
  so the bare value understated the collider the ride actually registers.
  `trestleSpots` now takes `footRadius` and is handed
  `POST_FOOT_RADIUS * ringSizeVsRace`.

## Gate status on this branch right now

- `tsc --noEmit` exit 0
- `typecheck:test` exit 0
- `check:rail-race` exit 0
- `test:procgen` exit 0 (515/515)
- `check:entrance-road` **exit 1, deliberately** — the sweep and the control are
  green; the plan-versus-park clause is red until the ribbon and the bus move
- **`pnpm run check` NOT yet run in full.** Expect `check:cat-bus`,
  `check:park-map`, `check:arrival-*` to have opinions once the road actually
  moves (see below) — they do not today, because it has not.

## What is left — and the one big piece

**`Entrance.ts` still builds the OLD straight kerb, and `ArrivalSequence` still
drives the bus along the old straight line.** So today the branch has a road
corridor that the ride respects and a road mesh that ignores it. That is a
half-state; it is coherent (nothing is worse than `main`) but it fixes nothing
visible yet.

To finish:

1. **`Entrance.ts` `buildEntranceRoad`** — replace the axis-aligned
   `roadRibbon` kerb with a ribbon swept along `entranceRoadStations()`.
   `roadRibbon` is straight-only; a curved sibling is needed. Keep
   `applyRoadUvs`'s divisors (`ROAD_HALF_WIDTH * 2`, `ROAD_TILE_METRES`) as the
   one owner of the scale — write `u` across and `v` as arc length, do not
   invent a second scale. The gateway spur should start at the kerb's **inner**
   edge at the gate (`entranceRoadAt(0)` minus `ROAD_HALF_WIDTH` along its
   normal) to keep #472's coplanar fix.
2. **The bus follows the road.** `ArrivalSequence` currently lerps a scalar
   `busX` and calls `placeBus(x)`, which does
   `position.set(x, terrainHeight(x, ENTRANCE_BUS_STOP_Z), ENTRANCE_BUS_STOP_Z)`
   and a fixed `BUS_FACING`. That becomes an **arc parameter**: `entranceRoadAt(s)`
   for position, and `atan2(headingX, headingZ)` for facing. Dispose the bus once
   it is past the brow (outset ≥ `RIM_OUTSET_START`, about `s = ±26`) rather than
   letting it drive down a 50° slope.
3. **Blast radius of `ENTRANCE_BUS_STOP_Z`** — it is the wall + 9 m today and the
   road is now at wall + 4.49, so it is wrong for everything that reads it:
   `ui/parkMapContent.ts`, `entrance/arrivalSightline.ts`,
   `entrance/ArrivalSequence.ts`, `entrance/Entrance.ts` (the shelter),
   `scripts/check-cat-bus.mts`, `scripts/check-park-map.mts`,
   `test/procgen/invariants.ts`. The one-owner move is to **delete it from
   `layout.ts`** and have those read the route. `roadRoute.ts` imports
   `layout.ts`, so the dependency must stay that way round — do not make
   `layout.ts` import `roadRoute.ts`.
4. **A check that measures the thing.** `scripts/check-entrance-road.mts`:
   the bus's swept body against every trestle collider, per seed over
   `PARK_SEED_POOL`, printing the count on every run (to `process.stderr`, so a
   passing run still says what it covered). Prove it red first — reverting the
   `groundIsClear` line gives 2–8 legs per seed, the table above is the
   transcript to compare against. Add it to the `check` chain and verify by
   **parsing** `package.json`'s `scripts` object, never grepping.
5. **Reach vs the frustum.** `IsoCamera.frustumBase()` is the owner and it is
   aspect-dependent — **call it, never copy it.** At `CAMERA_ZOOM_MIN`: 16:9
   desktop reaches 29.0 m of ground up-screen (43.0 m to the furthest ground
   corner); a 390×844 portrait phone 47.8 m. The road reaches 40.8 m before the
   ground itself ends. **Say this plainly to Jim rather than shipping it
   quietly:** the road does not stop in a field any more — it goes over the
   hilltop's brow at ~26 m and there is no ground beyond — but on a tall phone
   the frame can reach further than the hilltop does. That is a property of the
   diorama, not of the road.
6. **Browser QA** (this agent had the browser granted but has not used it):
   the grey under the park's own light, the road reaching the edge of the view
   fully zoomed out, and **the bus actually driving in** — the clipping is
   motion and a still cannot show it. Own port, `--strictPort`, kill by PID.

## Gotchas

- `pnpm run <x> | tail` **masks the exit code** — `[ELIFECYCLE] ... exit code 1`
  appeared while `$status` read 0. Redirect to a file and read `$status`.
- Another agent's branch has deleted `ENTRANCE_GATE_HALF_ANGLE` and given the
  gate aperture one owner in metres. Expect a conflict near the entrance
  geometry.


---

# The arc is real (3 September, later)

The road is drawn on the route and **the bus drives it**. `ENTRANCE_BUS_STOP_Z`,
`ENTRANCE_BUS_ARRIVE_X` and `ENTRANCE_BUS_VANISH_X` are deleted from `layout.ts`;
all seven consumers read `roadRoute.ts`. No scalar `busX` survives.

## Numbers the arrival-camera branch needs

- **The bus's door, and so the stop: x −0.07, z 65.83**, bus yaw **−102.0°**
  (was: door at x 0, z 69, yaw −90°). The stop moved **3.2 m towards the wall
  and 12° round**, because the road hugs the boundary now instead of cutting a
  straight chord across the ride.
- The bus drives on at arc **+39.6 m** and is disposed at **−39.6 m** — the brow,
  both ways, so it comes over the hill rather than appearing on a kerb.
- The road reaches **81.6 m** from the gate before the ground ends, past the
  47.8 m a 390×844 portrait phone sees at full zoom-out.

## Two more findings, both instruments measuring the wrong thing

- **`check:cat-bus` used an axis-aligned box round a bus that now turns.** An
  AABB round a 15.8 × 5.3 m vehicle at 45° is ~14.9 m square — nearly three
  times its footprint. It produced three confident wrong failures at once: "the
  bus reached 6.15 m INSIDE the park", "two children left 0.00 s apart", "the
  slowest child walked 1.54 m/s". Fixed by asking in the bus's **own** frame
  (`worldToLocal` against a local box measured off the built vehicle).
- **The tail turned tighter than a bus can drive.** `ENTRANCE_ROAD_TAIL_RUN` was
  14 m, chosen to cross the ride's line steeply — the wrong thing to optimise. A
  14 m tail turns at a **3.6 m radius** for a 15.8 m bus and put it **2.17 m
  inside the park**, which is #195 reintroduced by the road's own shape. Swept:
  37 m clears by 0.23 m, 45 m by 0.66 m, 55 m by 0.77 m at a 24.4 m radius
  (~1.55 bus lengths, a real turning circle), and past 55 the binding constraint
  becomes the kerb's own curvature instead, so 65 buys nothing. **55.**
- The road's outset also had to carry the bus's **silhouette** (1.24 m of tail,
  whiskers and swung door — the same figure `arrivalSightline.ts` pads by),
  because the box cleared by 0.77 m while the built bus was 0.23 m inside.

## Gate status

- `tsc` 0, `typecheck:test` 0
- `check:entrance-road` **0** — 0 legs hit on all sixteen seeds, spur abutting,
  control still finding 75 legs on the old road
- `check:park-map` 0, `check:arrival-completes` 0
- `check:rail-race`, `test:procgen`, `check:coplanar`, full `check` — **not
  re-run since the tail lengthened to 55.** They must be.
- `check:cat-bus` **1**, one real fault left, below.
- `check:arrival-starts` 1 — it wants a dev server on 127.0.0.1:5173 and could
  not reach one; environmental, not yet judged.

## The one real fault left

`check:cat-bus`: *"two children left the bus only 0.00 s apart"* and walking
speeds of 0.87 and 7.15 m/s. The park-intrusion complaint is gone; this is a
**behavioural** consequence of the stop moving 3.2 m closer to the wall — the
walk from the door through the arch is now ~5 m instead of ~9, so the
disembarking stagger (which is paced off that geometry) compresses and the
release fires several children on one frame. It wants the stagger driven by
time rather than by distance-to-the-gate. Nothing about it is measurement
error; the check is right.

**Nobody has looked at any of this in a browser yet.**


---

# The stagger is NOT a pacing bug — it is the door (3 September, later still)

**Correcting my own diagnosis, and the Overseer's instruction that followed it.**
I reported the disembark fault as "pacing driven by distance-to-the-gate, wants
pacing by time". That was wrong, and reading the code rather than inferring from
the symptom shows it: `KID_DELAYS` is **already** time-based and has been since
it was written — a cumulative `KID_DOORWAY_GAP + dawdle` per child, computed once
at module scope from a fixed seed, with a comment explaining that cumulative was
chosen precisely so jitter cannot eat the gap. There is no distance in it.

## What is actually wrong (`scripts/probe-door.mts`)

```
doorDrop local  x -4.66 z -2.55
stopAt -2.55  bus centre -2.58, 65.41  facing -96.6deg
door lands at   0.49, 61.08
gate is at      0.00, 60.00
door -> gate    1.18 m
door -> her     9.70 m
```

**The bus's door now opens 1.18 m from the middle of the arch.** The road hugs
the wall at `ENTRANCE_ROAD_OUTSET` = 5.73, the door sits 4.66 m towards the park
from the bus's centre, so the drop lands **1.07 m outside the park's edge** —
against about 4.3 m on the old road. The children step down essentially *in the
gateway*: their walk route is a degenerate stub, `releaseDistanceFor` is
satisfied almost at once, and several are handed to the NPC system on the same
frame. That is what `check:cat-bus` is reporting as "0.00 s apart" and as speeds
of 0.87 and 7.15 m/s. The timing code is innocent.

It is also simply wrong to look at: a bus door should open onto a pavement, not
into a doorway.

## The constraint this exposes, which the road's design missed

The door has to stand clear of the arch, and the door is `4.66 m` from the bus's
centre on the park side. So

```
ENTRANCE_ROAD_OUTSET >= (pavement the child needs) + 4.66
```

A child needs somewhere to step down and turn — on the order of
`CHILD_FOOTPRINT * 2` (3.6 m) — which wants an outset near **8.3**, and the old
road's 9 was not arbitrary after all.

**That reopens the trestle question in the other direction.** At outset 8.3 the
corridor spans 4.4 to 12.2, so a leg cannot clear it by moving *outward*
(`RIM_OUTSET_START` is 12 — it would be on the hillside). It has to move
**inward**, into the band between the road and the wall: leg centres in roughly
1.3 to 3.7 outset, which is 2.4 m of usable band and is inside `RADIAL_NUDGES`
(−3 from 6.5). Whether the ride absorbs that is a measurement, not a guess —
`check:entrance-road`, `check:rail-race` and `test:procgen` are what answer it,
and none has been run against that geometry.

**Do not simply raise the outset and push.** Each change to it invalidates every
gate below, and this branch has now oscillated through three values of
`ENTRANCE_ROAD_TAIL_RUN` and two of the outset. The next session should:

1. Derive the outset from the door, not tune it — `roadRoute.ts` should state
   `ENTRANCE_ROAD_OUTSET` in terms of the bus's own `doorDrop` and a stated
   pavement width, so it moves on its own if the bus is ever rebuilt.
2. Re-run `check:entrance-road`, `check:rail-race`, `test:procgen`,
   `check:coplanar` and full `check` **in that order**, and expect the trestles
   to need the inward nudge.
3. Only then look at it in a browser.

## Gate status, unchanged from above except

- `check:cat-bus` **1** — one fault, now correctly diagnosed as the door's
  position rather than the stagger's pacing.
