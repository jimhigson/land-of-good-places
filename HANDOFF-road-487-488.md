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


---

# The outset is derived now, and the stagger fault is pinned (3 September)

## The road

`ENTRANCE_ROAD_OUTSET` is no longer "as close to the wall as a road can be laid".
It is **derived from the door**: `DOOR_PAVEMENT + BUS_DOOR_INBOARD` =
`CHILD_FOOTPRINT * 2 + 4.66` = **8.26 m**. The floor (the door needs two children
abreast of pavement before the arch) and the ceiling (the outer kerb must stay
inside `RIM_OUTSET_START`, 8.11) **cross by 0.15 m**, which is the honest
statement of how full the apron is; the road takes the floor and its outer kerb
overhangs the very start of the rim by 15 cm, where the fall is under a
centimetre.

**Numbers the arrival-camera branch needs (measured, `scripts/probe-door.mts`):**

```
doorDrop local  x -4.66 z -2.55
bus centre     -2.58, 67.96   facing -97.4 deg
door drop      0.55, 63.67
door -> gate   3.71 m
```

So the **drop is (0.55, 63.67)**, not near z 64.5, and **D = 3.71 m**, not the
4.50 m the camera branch assumed — worse, not better. Its own preferred fix
(moving the shot's focus a metre or two out along the bus) is therefore load
bearing rather than optional. The stop is *not* a free parameter for me: it is
pinned between the door's pavement and the rim, with 0.15 m of overlap and no
slack to give.

Their second finding is right and matters here: `SQUARE_ON_TO_THE_DOOR_DEGREES`
deriving from the gate->stop line rather than the bus's own facing now diverges
by **7.4 deg** on this geometry (bus facing -97.4 deg against the -90 deg that
line implies).

## Gates at this geometry

- `check:entrance-road` **0** — 0 legs hit on all 16 seeds. The ride absorbed it
  by nudging legs **inward**, into the band between the road and the wall.
- `check:rail-race` **0** — the ride still races with its supports moved.
- `tsc` 0, `typecheck:test` 0, `check:park-map` 0, `check:arrival-completes` 0.
- `test:procgen`, `check:coplanar`, full `check` — still not run at this outset.
- `check:cat-bus` **1**, one fault, diagnosed below.

**One caveat on the control, found by watching it move.** The control's hit count
fell from 96 to 35 as the trestles moved out of the road, because it sweeps the
*old* line against the *new* placement. It still discriminates (35 hits, worst
2.83 m) so the runs above stand, but if the ride ever moved its legs clear of the
old line too the control would read zero and void a perfectly good run. The
stronger form is to place trestles once with the corridor disabled and sweep
against *those*. Worth doing before this merges.

## The stagger: pinned, and it is a real pre-existing bug

Not systemic. `children left over 8.3 s, tightest gap 0.02 s` — the spread is
right for eleven children; **one pair** is too close.

A child leaves the bus at `delay + aisleSeconds`. `KID_DELAYS` staggers the
`delay` — when they *start* down the aisle — but `aisleSeconds` is per-child,
because it is how far their own seat is from the door. So a child with a short
aisle walk catches the one in front with a long one: `delay_n + 2.0` against
`delay_n + 0.64 + 1.4` is 0.04 s apart, which is exactly the shape of what is
measured.

**The queue is paced at the wrong end** — at the seat, not at the door.

Why it surfaced now: it did not become true, it became *visible*. `check:cat-bus`
was measuring an axis-aligned box round the bus, which is ~3x its real footprint
at 45 deg; children were counted as still aboard well after they had stepped
down, which smoothed the difference away. Fixing the instrument to ask in the
bus's own frame is what exposed it. Moving the door from 1.18 m to 3.71 m from
the arch improved it (7.15 -> 5.27 m/s) but cannot fix it, because the cause is
not the geometry.

**The fix** is to stagger the *door* rather than the seat: choose each child's
delay so that `delay_n + aisle_n >= delay_{n-1} + aisle_{n-1} + KID_DOORWAY_GAP`.
It needs `KID_DELAYS` to stop being module-scope (it is computed before seats are
known, and `BUS_WAITS_FOR_THE_REST` reads it), so it becomes per-instance work in
`ArrivalSequence`'s constructor once the seats exist. Not a change to make in the
last five minutes of a session, which is why it is written down instead.


---

# The disembark fault was not the stagger at all (3 September, session 3)

**Two previous diagnoses of this were wrong and are recorded above. This is the
third, and unlike the others it was measured before it was believed** —
`scripts/probe-disembark.mts`, which prints every child's delay, aisle time,
door time and the instant they actually leave the bus's footprint.

## Root cause

`World`'s constructor calls `ArrivalSequence.attachNpcs`, which sized each
child's walk down the bus by the **world** distance from their seat to the drop.
It runs while the bus is still standing at the far end of the road it has yet to
drive — **measured, 36.26 m from the drop**. So:

```
bus stands at 31.59, 82.42 when attachNpcs measured the aisles
the drop is at 0.55, 63.67
bus -> drop   36.26 m
longest walk down the bus itself: 14.00 m = 5.49 s (KID_AISLE_SECONDS)
```

Every child's `aisleSeconds` came out **12.74–16.28 s** against the 5.49 s this
file's own timeline budgets. Three symptoms, one cause:

- they crawled (`check:cat-bus` measured 0.87 m/s in a 2.55 m/s park);
- **six of the eleven never reached the door at all** inside the sequence and
  were left behind by the departing bus rather than walking out of it;
- and the 36 m every seat shared **compressed the differences between them** —
  two seats either side of the gangway are all but equidistant from a point
  36 m away — which is the reported "two children left 0.02 s apart".

**The proposed fix in the handoff above (restaggering `delay_n + aisle_n` in the
constructor) would not have worked, and would have measured nothing.** Seats are
already handed out nearest-the-door-first, so `delay + aisle` was already
monotone with a gap of at least `KID_DOORWAY_GAP`; the quantity `check:cat-bus`
measures is the moment a child leaves the bus's *footprint*, which is a
different instant. `KID_DELAYS` stays at module scope and untouched.

## The fix

One line of intent: a seat's distance to the door is a property of the bus, not
of where the bus is parked, so it is asked in the **bus's own frame** —
`bus.root.worldToLocal(seat)` against `bus.doorDrop`, which is that same local
point. Exactly the cure `check:cat-bus` itself was given when the bus started
driving a curve.

Measured after: aisle times **1.37–3.41 s**, all eleven reach the door, tightest
gap at the footprint **0.017 s -> 0.650 s** (needs 0.64), walking speed
**2.48–2.69 m/s** against the park's 2.55. `check:cat-bus` exit 0.

**The drop did not move** — still (0.55, 63.67), D = 3.71 m. Nothing here
changes the number the arrival-camera branch is building its shot around.

**One thin margin to know about:** the gap clears its floor by 0.01 s. It is
deterministic (fixed `ARRIVAL_SEED`), so it is not flaky, but it is close.
The cause is that children walk a straight line from their seat to the drop and
so cross the bodywork *smeared up to 2.14 m along the door side* rather than at
the door — measured, `probe-disembark.mts`. Walking them down the gangway to the
door and out (an L, which is what `CAT_BUS_LONGEST_WALK_TO_DOOR` already models:
`CABIN_LENGTH_FROM_SEATS + BODY_WIDTH / 2`) would restore the designed 0.706 s
floor and stop children stepping out through the side panel of a bus with
windows. Not done — it is a visible behavioural change and wanted its own QA.

# The control is stronger, and the old one was decaying

`check:entrance-road` no longer sweeps the *old* road line against the *new*
legs. Every seed is now built **twice**: once as the game builds it, once with
`setEntranceCorridorHonoured(false)`, which switches off the single clause in
`groundIsClear` that keeps legs out of the road. The identical sweep runs
against that park and must come back dirty.

- old control: 1–4 legs per seed, **35 total**, as low as one leg on seed 11
- new control: **8–10 legs per seed, 151 total**, worst 2.40 m inside a bus
- cost: 28.6 s -> 50.3 s wall clock (16 seeds x 2 parks)

**Proved red**, geometry = this branch at road outset 8.26: mutating the sweep
to look for `railRace:trestle-legs-TYPO` makes the control report zero on all
16 seeds and the run is declared void, exit 1.

# Two red gates that were hiding behind each other

**`test:procgen` was red on this branch and green on `main`** — 4 files failed,
**328 tests silently skipped**, 187 passed. Two separate faults, one masking the
other:

1. `invariants.ts` had gained a **static import of `roadRoute.ts`**, which
   reaches `world/boundary.ts` and so loads the seeded manifest at the test
   file's own module load — before `buildParkFacts` sets `LGP_SEED`. Every
   non-canonical seed built the canonical park and threw; `seed-canonical`
   passed because its seed *is* the default. Exactly the trap CLAUDE.md
   documents. Fixed by putting the bus's start point on `ParkFacts`
   (`startsAtX/Z`) behind a dynamic import, as `hidesTheArrivingBus` already
   was. **Audited the whole file afterwards** (`/tmp/audit.mjs`, walks every
   non-`type` static import transitively): no other chain reaches
   `parkManifest.ts`.
2. With the skips gone, **two real failures appeared underneath** — foliage
   standing in front of the arriving bus on seeds 5 and 11. `hidesTheArrivingBus`
   was the only keep-out on a planted thing asked as a **bare point**, while
   `isPlantable` and `clearOfCruiser` both take a reach; `Scenery.ts` sites a
   clump by its centre and then rolls blobs up to `BUSH_REACH`/`TREE_REACH`
   away. Measured (`scripts/probe-sightline.mts`): every offender stood
   *lower* than the nominal height its planter passed, so height was never the
   fault — the offset was. It only went red now because the road's longer,
   curved approach brought the corridor out to where the scatter lives.
   `hidesTheArrivingBus` takes a `reach` now and every planter passes its own.

`test:procgen` after both: **exit 0, 515 passed, 0 skipped.**

# State

Rebased onto `origin/main` (3799fae1), clean, no deletions in
`git diff --diff-filter=D origin/main...HEAD`. Script step sets compared by
parsing `package.json`: branch adds exactly `check:entrance-road`, drops
nothing, 59 steps in the chain.

- `tsc` 0, `typecheck:test` 0
- `test:procgen` **0** (515/515, no skips)
- `check:entrance-road` **0**, control 151 legs
- `check:cat-bus` **0**
- full `pnpm run check`, `check:coplanar` — running
- `check:arrival-starts` — **red, not yet judged**: no hand-over within 75 s at
  6x throttle, `hud` never appears and `sawHidden` never becomes true. Needs a
  control run against `origin/main` on an idle machine; the first run was taken
  while the box was saturated, which makes a throttled timing test meaningless.


---

# The road was invisible, and every check said it was fine (3 September, later)

**The headline finding of this session, and it was found by looking.** After the
gates went green I opened the park and photographed it. The bus was standing on
**grass**. There was no road.

`scripts/probe-live2.mjs`-style queries against the running page and then the
headless park pinned it in three steps:

1. Both `entrance-road-kerb` and `entrance-road-gateway` are in the scene,
   `visible`, opaque, sharing one `MeshToonMaterial` with a 512x512 map and sane
   UVs. So not a missing mesh and not a missing material.
2. All 1287 kerb vertices are a uniform **0.06 m above the terrain** — not
   buried, not z-fighting.
3. **Every one of its 2272 triangles faced *down*** — mean vertex normal.y
   **-0.822**, against the gateway spur beside it at **+1.000**. The material is
   `FrontSide`, so the whole road was back-face culled. What little you could see
   was the faint band of its own shading on the grass.

## Cause

`curvedRoadRibbon` builds a `PlaneGeometry`, which is authored in the **XY**
plane facing +Z and indexed to be front-facing from there, and then rewrites
every vertex into the **XZ** plane. Going from (right, up) to (across, along)
flips the handedness of the surface, so the inherited index winding comes out
backwards. The straight `roadRibbon` beside it does not have this because it is
built in world space from the start.

Fixed by reversing every triangle's winding before `computeVertexNormals`.

## Why nothing caught it

**Every check in the file reads vertex positions.** `check:entrance-road` proved
all 1287 of them lay inside the bus's corridor and 0.06 m above the lawn, on all
sixteen seeds, and said so proudly — about a road nobody could see. That is
CLAUDE.md's "an assertion reporting success about something it is not
describing", in the one form none of the existing clauses could reach.

`check:entrance-road` now asserts the facing too. **Proved red** at the geometry
of this branch (road outset 8.26, canonical seed): removing the winding flip
gives **2272 of 2336 triangles facing the ground**, and 0 with it in. It prints
`facing: 38400 road triangles checked, 0 facing the ground` on every run.

# Open: two coplanar seams, and they are mine

`pnpm run check:coplanar` is **red, exit 1, 2 new seams** — and they are a
direct consequence of the road becoming visible, because the sweep only counts
faces a camera can reach. They were always there and were culled.

```
NEW: garden|entrance/entrance-road-gateway|entrance/entrance-road-kerb
    5.202 m² of shared plane, 3.1e-4 m apart, seed 326
NEW: garden|entrance/entrance-road-kerb|garden/terrain
    1.434 m² of shared plane, 8.1e-3 m apart, seed 208
```

**The spur one is structural, not a nudge.** The spur is a straight ribbon down
`z`; the kerb it meets is a curve. Their join line therefore has a different `z`
at every `x`, and a straight edge can only *overlap* the kerb (what happens now,
on the seeds where the curvature is strongest) or leave a wedge of grass. Taking
the middle's answer — `entranceRoadInnerEdge(0).z` — is what #472 left behind,
and it was correct while the road was straight.

**I attempted the real fix and backed it out.** Building the spur as a grid whose
outer edge follows `entranceRoadInnerEdgeAtX(x)` per column made it **worse — 3
findings**, adding a `path-surface` seam, because interpolating between station
edges does not land on the kerb's own triangle edges. That work is reverted; the
branch is at the simpler, well-understood state. Whoever takes it needs the
spur's outer row to be *the kerb's actual boundary vertices*, not a resampling of
them — most likely by having `curvedRoadRibbon` hand back its inner edge ring and
building the spur off that ring directly.

The terrain one is the coarse road grid over a convex hillside: the road is
`terrainHeight` + 0.06 at its own vertices, and between them the ground rises to
within 8 mm. Sampling the terrain's maximum across each quad rather than at its
corners is the honest fix; raising the lift is a stand-off and ART_DIRECTION.md
§7 forbids it.

# `check:arrival-starts` is red on `main`, not on this branch

Given a dev server at last (`ARRIVAL_URL` points it anywhere — it does not need
5173), it fails at its default 6x throttle: no hand-over inside 75 s.

**Controlled.** `origin/main`, same machine, same throttle, fails identically —
`parked=true` from t+21s, `hud` never appears. So it is not this branch:

| | 1x | 3x | 6x |
|---|---|---|---|
| this branch | **pass**, 22.8 s | pass, 39.2 s | fail |
| `origin/main` | — | pass, 37.1 s | fail |

Park generation is **not** the cause and my first hypothesis was wrong: measured
headlessly, three runs each, branch 1749-1848 ms against main 1715-1840 ms.
It is simply over the ceiling on a slow device — the exact failure the check was
written for, now true again on `main`. **It needs its own ticket and its own
engineer**; it is not in the `check` chain, so nothing in CI is red because of it.

# State at handover

- `tsc` 0, `typecheck:test` 0
- `test:procgen` **0** — 18 files, 526 tests, 0 skips
- `check:entrance-road` **0** — 0 legs hit on 16 seeds, control 151 legs, 0 of
  38400 road triangles facing the ground
- `check:cat-bus` **0**, `check:bus-journey` **0**
- full `pnpm run check` **0** (re-run after the winding fix)
- `check:coplanar` **1** — the two seams above, open
- `check:arrival-starts` 1 at 6x, red on `main` too
- QA: the bus photographed driving in on a grey road, clearing the trestles;
  the intro ride's lane confirmed still sand.

## The spur seam, measured exactly (for whoever fixes it)

Not a convention mismatch — I checked that and was wrong: on seed 326, **0 of 143
stations** disagree about which side `entranceRoadInnerEdge` and
`curvedRoadRibbon`'s column 0 call "inner". They are the same edge.

It is purely the straight-edge-meets-curve problem, and here is the size of it:

```
seed 326
spur starts at z 65.72                     (entranceRoadInnerEdge(0).z)
kerb inner edge across the spur's width:   z 63.86 .. 66.71   spread 2.84 m
```

So the kerb reaches **1.86 m past where the spur begins** at the worst column,
and the two cover that band in the same plane — 5.202 m², which is that overlap.

The fix has to take the spur's outer row from **the kerb ribbon's own boundary
vertices** (`curvedRoadRibbon` should return its inner edge ring, and the spur be
built off that ring), not from a resampling of the station curve. Resampling is
what I tried and it left the seam while adding a `path-surface` one.


---

# The spur is a path, the road is cleared of trees (3 September, session 4)

Model: **Opus 5 (1M context)**. Worktree
`.claude/worktrees/road-spur-path`, detached on `origin/fix/road-487-488`
(the branch ref itself is held by the dead `road-487-488` worktree, so pushes
go `git push origin HEAD:fix/road-487-488`).

## Jim's two asks, both in

**1. "the small run of path from the road into the park should be just a
normal path".** Done. The spur is no longer road: it is drawn from a new
`src/world/pathSurface.ts`, which now owns *what a park path is made of* —
the two materials, the accumulator and the ribbon sweep, moved out of
`pathGraph.ts` because importing that module **runs the whole path solve** and
`Entrance.ts` must not be what triggers it. So the run through the gate is the
same surface as the network it joins rather than a copy of it.

- **Width comes from the paving it meets** (`forEachPavedDisc`'s own radius at
  the point it reaches), so 2.8–3.2 m across the pool rather than a number.
- **Length likewise**: 5.9–10.2 m on the sixteen seeds.
- Meshes renamed `entrance-road-gateway` -> `entrance-gateway-path`,
  `-kerb-left`, `-kerb-right`. `check:entrance-road` follows the new names and
  keeps clause 3's reasoning verbatim; `theRoadArrivesAtTheParkAndGoesIn` was
  widened to both families and **went red the moment the rename landed**,
  which is the invariant doing its job.

**2. "the bus drives through trees on its final approach".** Done, and it was
structural. Measured on the built park (`scripts/probe-road-trees.mts`):
**64–106 treeline instances per seed inside the corridor the bus sweeps**, at
outsets 13.7–21.1 m. `Scenery.ts`'s treeline band is 11.5 m to
`TERRAIN_APRON - 1.5`; the road's tails climb through it to 23.5. The two
share an annulus by construction.

**The trees give way, and the ordering says so rather than a preference:**
`roadRoute.ts` derives the corridor from `PARK_BOUNDARY` alone — no scenery,
no rides — so it is a pure pre-scene plan in the exact sense `onRailway`
already documents for the train, and at the moment it solves no tree exists to
avoid. The road cannot move either: its outset is pinned between the bus
door's pavement and the rim, bounds that cross by 0.15 m. So `buildTreeline`
refuses a spot whose canopy reach enters `distanceToEntranceCorridor` — the
**swept body sampled at 0.2 m**, not the ribbon — after every rng draw, so the
stream is untouched. 58 trees felled on the canonical seed; 0 instances left
in the corridor on every seed probed.

### The invariant

`nothing is planted in the road the cat bus drives`, on `ParkFacts.
treesInTheBusRoad`, measured off **instance matrices in the built scene**.
Prints `[bus road cover] N planted instances swept …, M inside it` to
`process.stderr` every run.

**Proved red against the geometry of commit `260174d3`** (road outset 8.26,
treeline band 11.5..`TERRAIN_APRON`-1.5, tails 55 m to outset 23.5) by
neutering the single keep-out line in `buildTreeline`:

```
seed 11        59 in the corridor, worst 3.02 m inside
seed 18        57
seed 24        84
seed 5         97
seed canonical 91
Test Files  5 failed | 13 passed (18)
Tests  10 failed | 521 passed (531)
```

(The second failure per seed is `the road arrives at the park…`, red for the
unrelated rename reason above; both green together afterwards.) With the line
in: **exit 0, 531 passed, 0 skipped**, 1660–2008 instances swept per seed.

## The seam that was called structural is gone

The branch inherited *"the spur one is structural… a straight spur meeting a
curved kerb whose inner edge spans 2.84 m of z"*, 5.202 m², with a note that
the previous attempt made it worse. **It is closed**, and the recipe is the
one that handoff predicted:

`roadRoute.ts` now owns the kerb's inner edge as a **ring**
(`entranceRoadInnerEdgeRing`), `curvedRoadRibbon` sweeps its column 0 through
that ring so the drawn kerb's boundary *is* the ring, and
`entranceRoadInnerEdgeAcross(centre, half)` hands back the stretch of it under
the path with **the two ends interpolated along the ring's own segments** — a
point on a segment between two ring vertices lies exactly on the drawn kerb's
triangle edge, which is what the earlier resampling of the *centre line* did
not. Zero overlap, zero gap; `check:entrance-road`'s abut clause is green on
all sixteen seeds.

Measured why a chord is not enough (`scripts/probe-spur-edge.mts`): across a
path's width the inner edge still spans 0.089–0.932 m, and even the chord
between the two end points departs from the polyline by up to **2.7 cm** —
inside the sweep's 1 cm "same plane" tolerance.

## `check:coplanar`: 2 seams inherited -> 4 open, and where they came from

Run it yourself; it is not in `pnpm run check`.

| seam | m² | mine? |
|---|---|---|
| `entrance-gateway-path` \| `garden/path-surface` | 0.240 | yes |
| `entrance-gateway-path-kerb-left` \| `garden/path-kerb` | 0.048 | yes |
| `entrance-gateway-path-kerb-right` \| `garden/path-kerb` | 0.060 | yes |
| `entrance-road-kerb` \| `garden/terrain` | 1.434 | **inherited** |

Gone since the session started: the structural spur/kerb one (5.202 m²), the
old `entrance-road-gateway`\|`path-surface` **baseline** entry (2.491 m² —
`coplanar-baseline.mts` says to delete it, still to do), and two I made and
then killed:

- **kerb-as-a-slab, 1.53 m² -> 0.05.** `main` rebuilt the network's kerb as
  its two visible bands while this branch was in flight (`addRibbonKerb`);
  built as a full-width slab the gateway path reproduced that exact buried
  face. Now drawn as bands too.
- **ballast, 3.14 m² -> 0.** On seed 288 the railway crosses the gate's
  approach 4.5 m in, so the run was laid down the ballast. It only appeared
  when the run became *paving*: a road at 0.06 cleared the 1 cm tolerance and
  paving at 0.055 does not. `BALLAST_HALF_WIDTH` is exported and the columns
  stop at it; the level crossing paves that band itself, so no grass.

**Why the remaining three are not zero, and what would fix them.** The far end
of the path is placed against `forEachPavedDisc` — an approximation of the
network's ribbons by discs at their samples — while the seam is measured
against the network's **actual triangles**. Columns are cut at 0.15 m
(`GATEWAY_PATH_COLUMN`) and each stops on its own, which took it from 0.64 to
0.24 m², but no column spacing removes the disc-vs-mesh mismatch. The clean
answer is for the path network itself to draw the run to the gate — one
surface, no join — which means a route in `paths.ts`'s graph reaching outside
the boundary, and that touches `isOnPath`, scenery keep-outs and NPC routing.
That is the next engineer's call, not a nudge.

The **terrain** one is inherited and untouched: the road ribbon is 8 columns
across a hillside whose convexity rises to within 8.1 mm of it between
vertices. The honest fix is still sampling the terrain's max across each quad
(or subdividing across, where the rim's fall is), never lifting the road.

## Gate status at `3406f871`

Read from each run's own log file, never a pipe.

- `tsc --noEmit` **0**, `typecheck:test` **0**
- `test:procgen` **0** — 531 passed, 0 skipped
- `check:entrance-road` **0** — 0 legs hit on 16 seeds, control 151 legs,
  0 of 38616 road triangles facing the ground, spur abutting
- `check:coplanar` **1** — the four above
- full `pnpm run check` — running in CI on this head, not yet read
- CI at `9ec90db2` failed `typecheck:test` on an `ENTRANCE_ANGLE` import my
  rebase resolution left unused. Fixed in `3406f871`. **Run `typecheck:test`
  as well as `tsc` after any rebase** — `tsc --noEmit` cannot see test files.

## Rebase, and the two conflicts worth knowing

Rebased onto `origin/main` `44ede1e8` (the PR was `CONFLICTING`, which is why
**no CI and no preview ran on four of my pushes** — a conflicting PR gets no
merge commit, so `pull_request` workflows never fire. If your pushes are
producing no runs, check `mergeable` before anything else).

- `package.json`: resolved by keeping both script definitions and then
  **parsing** the object — 106 steps on main, 107 here, dropped `[]`, added
  `["check:entrance-road"]`; chain 58 -> 59, same delta.
- `pathGraph.ts`: main's banded kerb vs my move of the ribbon sweep into
  `pathSurface.ts`. Both wanted; see the kerb note above.
- `git diff --diff-filter=D --name-only origin/main...HEAD` is **empty**.

## Ports

- **5297** is mine (`vite --port 5297 --strictPort`, started from this
  worktree). Kill by PID when done.
- **5291 is Jim's link and serves the `road-stagger` worktree at `f4160b18`**
  — i.e. the branch *before* any of this session's work. I could not move it
  (checking out in another agent's worktree is blocked here). Anyone handing
  Jim 5291 is showing him the road-through-the-gateway he complained about.
- Preview for `3406f871`:
  `https://pr-498-3406f87-land-of-good-places.blockstack.workers.dev` — loaded
  and photographed at the gateway; both changes are in it.


---

# The four seams are closed (3 September, session 5)

Model: **Opus 5 (1M context)** — matching the agent I replaced, per CLAUDE.md's
"a replacement runs the same model". Worktree
`.claude/worktrees/road-seams-498`, detached on `origin/fix/road-487-488`
(the branch ref is held by the dead `road-487-488` worktree, so pushes go
`git push origin HEAD:fix/road-487-488`).

**Nothing Jim can see changed in this session.** Both of his asks were already
in the build he approved; this is the finish — `check:coplanar` going green,
which does not merge red.

## All four are closed, and three of them were one bug

| seam | m² before | after |
|---|---|---|
| `entrance-gateway-path` \| `garden/path-surface` | 0.240 | **0** |
| `entrance-gateway-path-kerb-left` \| `garden/path-kerb` | 0.048 | **0** |
| `entrance-gateway-path-kerb-right` \| `garden/path-kerb` | 0.060 | **0** |
| `entrance-road-kerb` \| `garden/terrain` | 1.434 | **0** |

Nothing was filed elsewhere and nothing was baselined.

### The first three: the run was placed against an approximation

Same shape as the fix already on this branch, where `roadRoute.ts` came to own
the kerb's inner edge as a ring so the two meshes share a boundary by
construction rather than by two approximations agreeing.

`columnReach` stopped each column of the run against `forEachPavedDisc` — the
paving as **circles at the centreline samples**, published for `NavGrid` to
rasterise. That is the right shape for a router and the wrong one for abutting
a surface, in two ways, and **both were measured rather than assumed**
(`scripts/probe-gateway-seam.mts`, which reproduces the sweep's own areas to
within 10% before changing anything):

- **The discs scallop.** They sit *at* the samples; the ribbon is drawn as a
  strip *between* them, so the union pinches to `sqrt(r² − (s/2)²)` where the
  drawn surface runs straight across at `r`. **67%** of the surface seam lay on
  ground the discs called clear, up to 0.17 m past them.
- **The kerb is not in the disc list at all**, deliberately — `publishPaving`'s
  own comment says a child walks the surface. So the kerb bands were stopped
  against a surface they never touch, with a fixed `PATH_KERB_OVERHANG` margin
  standing in for a kerb that reaches **twice** that around the plaza
  (`addAnnulusKerb` draws it to `radius + OVERHANG * 2`). **100%** of both kerb
  seams were outside the disc union, up to 0.57 m.

So `paving.ts` gained a second publication beside the first:
`publishDrawnPath` / `pointIsOnDrawnPath(x, z, layer)`, answered by
`pathGraph.ts` from the swept strip between consecutive samples of one `run`,
at the layer's own reach. `forEachPavedDisc`, `isOnPath` and the scenery
keep-outs are **untouched** — the predecessor flagged that the clean fix might
have to pull those apart, and it did not.

`pointIsOnDrawnPath` returns **`null`, not `false`**, when nothing is
published: an interior harness has no network, and a caller reading `false`
would lay its surface straight through where the paving would have been.

**A capsule can only overstate the trapezoid drawn between two cross-sections**
(it rounds ends the strip cuts square), and overstating is the safe direction —
a caller stops a hair early rather than putting two surfaces in one plane.

### The off-by-one underneath it, which only appeared once the above was right

Fixing the approximation took the surface seam 0.2644 → 0.0675 m² and no
further, because `columnReach` returned the **first taken** step: every column's
last row landed one 0.05 m step deep *on* the surface it was abutting. It now
returns the last clear step, bracketed coarsely and then bisected 8 times to
**0.2 mm** — two orders under the sweep's 1 cm — so there is no overlap and no
strip of grass either. Stepping the walk that finely instead would cost 250x
the probes per column for the same answer.

Measured, seed 5:

```
                                   inherited   fix 1     fix 1+2
entrance-gateway-path|path-surface    0.2644   0.0675    0.0000
kerb-left |path-kerb                  0.0464   0.0087    0.0000
kerb-right|path-kerb                  0.0587   0.0157    0.0000
```

### The fourth: the road is a chord and the brow is a curve

**It was described as inherited. It is not** — `main` has no curved road; this
branch draws `entrance-road-kerb`, and the seam appeared on this branch the day
the winding fix made the road visible. So it was this branch's to close.

Each road vertex sits at `terrainHeight + 0.06`, so the drawn surface is the
chord between those heights while the ground is the curve. Over the brow that
ground is convex and bulges up between vertices: at 8 columns the 7.78 m road
spans about a metre a quad, the sag eats 5.2 cm of the 6 cm lift, and the
terrain comes within **8.5 mm** of the road.

Chord error falls with the square of the spacing, so `across` 8 → 16 quarters
it. Measured on seed 208 (`LGP_COPLANAR_CHILD=1 LGP_COPLANAR_GARDEN_ONLY=1`):

```
before   1.4337 m² of shared plane, separation 0.008513 m
after    no entrance-road|terrain seam at all
```

That is the fix ART_DIRECTION.md §7 asks for — the road follows its ground more
closely and the **lift is untouched**. Raising the lift would be the stand-off
§7 forbids, and it would go stale the moment the terrain moved.

## The loose baseline entry is deleted

`garden|entrance/entrance-road-gateway|garden/path-surface` (2.491 m²) matched
nothing — the mesh was renamed when the spur became a path — so it was a licence
for 2.5 m² of seam under a name nothing draws.

**The sweep reports its own stale rows** (`BASELINE LOOSE: … is gone`), which is
worth knowing: the loud half of the ratchet fails on a new seam, and this quiet
half is what stops the baseline silently accumulating permission nobody uses.

## Gate status

Exit codes read from each run's own log file, never a pipe.

- `tsc --noEmit` **0**, `typecheck:test` **0**
- `check:entrance-road` **0** — 0 bus/leg hits on all 16 seeds, control still
  dirty at 8–10 legs a seed (worst 2.35 m), so it still discriminates
- `check:coplanar` — see below
- `test:procgen`, full `pnpm run check` — see below

## For whoever is next

- **`isOnPath` has the same scallop error** as the disc list did, and it is what
  scenery keep-outs are asked against. Not touched here on purpose — it would
  move planting on every seed and belongs in its own PR with its own procgen
  run. `pointIsOnDrawnPath` is the exact answer if anyone wants to close it.
- The probe is committed as `scripts/probe-gateway-seam.mts` and takes a
  `LGP_SEED`; it prints the predicted scallop depth beside the measured one, so
  it can say "no" if this diagnosis ever stops being the right one.

## Rebased onto `main` (2 merges), and the PR is mergeable again

The PR was **`CONFLICTING`**, which is why no CI and no preview had run on the
last four pushes — a conflicting PR gets no merge commit, so `pull_request`
workflows never fire. It is **`MERGEABLE`** now, at `9a14e0fb`.

Rebased onto `488605cd` (#480/#482, the gate arch) and `f6b493f5` (#499, the
round-robin spine). 44 commits, two conflicts, both in `Entrance.ts`'s imports.

**The trap, and it is the one CLAUDE.md names.** Resolving both as a union left
`CAT_BUS_LENGTH`, `PARK_BOUNDARY` and `edgeRadiusAt` imported and unused —
`main`'s symbols going unused in a file we both touched, which is exactly the
shape of a silent revert. Checked before deleting rather than after:

- All three are used only by `main`'s **old straight road** — `kerbReach`
  clipping a straight kerb to the boundary spline, and `halfBus` off
  `ENTRANCE_BUS_STOP_Z`. This branch replaces all of it with the curved ribbon
  swept along `entranceRoadStations()`, and deletes those layout constants.
- They **predate #482**. #482's actual change to this file is the
  `buildGateArch` swap, which is present and used.

So it was supersession, not a revert, and the deletion is correct.

`tsc --noEmit` did not catch it on its own — **`typecheck:test` is what went
red**, the second time on this branch. Run both after any rebase.

Verified after the rebase:

```
git diff --diff-filter=D --name-only origin/main...HEAD    (empty)
scripts object   main 106, mine 107; dropped [], added [check:entrance-road]
check chain      main 58, mine 59;  missing [], extra [check:entrance-road]
```

### Gates on the rebased tree

- `tsc --noEmit` **0**, `typecheck:test` **0**
- `test:procgen` **0** — 19 files, **571 passed**, 0 skipped
- `check:coplanar` **0** — 224 seams, all in the baseline, none new
- full `pnpm run check` — running at handover; read `/tmp/check-full.log`

## A fifth red, found by the full chain: `check:cat-bus`

`pnpm run check` came back **exit 1** on the rebased tree, on a clause saying

```
the road has 2431 vertices outside the wall and 0 inside it — it does not
pass through the gate, so it arrives at the park without going in
```

about a gateway with a path laid squarely through it. **Inherited from the
session before this one, not caused by the seams work** — and it had never been
read, because the chain had only ever been started, not finished, on this
branch.

The cause is this repo's most common bug. When Jim asked for the run through
the gateway to be an ordinary park path, the surface changed material and so
changed **name**: `entrance-road*` → `entrance-gateway-path*`. Nothing about
the park moved. `theRoadArrivesAtTheParkAndGoesIn` in the invariant suite was
widened to both families at the time; **its twin in `check-cat-bus.mts` was
not**, and the two only failed to be noticed together because they live in
different suites.

The two vertex lists are kept **separate**, because the clauses ask different
questions: the bus stands on the **road**, and must never be satisfied by a
footpath it cannot drive on; the park is **reached** by whichever surface
actually gets there.

**Proved red** at this branch's geometry by mutating the gateway-path match to
an unmatchable name — all three clauses fire, including the new one asserting
the run exists at all:

```
- nothing is drawn between the road and the park — the run in through the gate is missing entirely
- the nearest paved surface gets to the gate is 4.4 m — it does not reach the park
- the arrival surface has 2431 vertices outside the wall and 0 inside it
```

Green, on every run: *the arrival surface runs from z 97 outside the wall to
z 58 inside the park, passing 0.45 m from the gate centre — 2431 vertices of
road (the bus's own surface) and 272 of gateway path carrying it in through
the arch.*

**The lesson worth keeping**: a mesh rename is a silent break of every check
that matches on the name, and `grep` for the old name finds the check but not
the *reasoning* that has gone stale. When a surface changes material, search
for both names everywhere, in checks and invariants alike.

## Which Node produced these numbers

This Mac's default `node` is **v25.6.1**; CLAUDE.md wants 26+ and CI pins 26.
Node **26.7.0** is at `/opt/homebrew/opt/node@26/bin/node` — `scripts/with-node`
does not find it, because it only searches nvm directories.

Another agent found the park simulation **non-deterministic under Node 26** on
some checks (1 failure in 8 runs, different numbers each time) where Node 25 was
byte-identical. **It does not affect `check:coplanar`.** Run twice under Node
26.7.0 on this head:

```
224 seams, 67 fighting at 0.1 mm, 157 stand-off under 1 cm, 169 buried,
none new — exit 0, both runs, byte-identical
```

and CI's own **Coplanar faces** and **Procgen invariants** jobs, which run on
Node 26, are **green on this head**. So the seam closure is confirmed on the
Node the repo actually requires, not only on the one this laptop defaults to.

The seam measurements in the sections above (`probe-gateway-seam.mts`) were
taken on Node 25.6.1; the coplanar ratchet that agrees with them has now been
run on both.

---

# Review of #498: changes requested (3 September, session 5 cont.)

CI on `01f9281a`: **all five jobs pass** (Checks, Coplanar faces, Procgen
invariants, Deploy PR preview, A reload gets the new build).

## The blocker — a real regression this branch causes

On `origin/main` the worst trestle leg **centre-vs-foot drift is 0.00 m** on all
six seeds measured: legs are vertical because `RADIAL_NUDGES` never fires. This
branch's `isInEntranceRoad` clause in `groundIsClear` (`track.ts:1276`) makes
those nudges fire **for the first time**, so legs now lean — 2.00 m drift, 4–5
legs a seed on the walk-past ring — and **each has its drawn post at 1.4 m
standing 0.30–0.91 m from the centre of a 0.272 m collider, up to 3.3x the
radius.** Collision is plan-view, so a child walks through the upper half of a
visible post. First rule of the project.

### Root cause, located

- `track.ts:875` — `trunkFoot.set(spot.x, ground, spot.z)`, the **nudged** spot.
- `track.ts:868` — `trunkTop` is derived from the lane tops, which are **not**
  nudged (`route.pointAt`, deliberately: a branch top is the middle of the lane
  it carries).
- So a nudged leg leans by construction, and that is intended — the comment at
  872 says so.
- `track.ts:894` — `collision.addCircle(spot.x, spot.z, POST_FOOT_RADIUS *
  ringSizeVsRace)`. **One circle, at the foot only.** That is the whole bug: the
  drawn post's plan-view footprint is a *segment* once it leans, and the
  collider is a point.

### The fix, and the one thing not to get wrong

Cover the post's plan-view span with a chain of circles from the foot to where
the post reaches **child height** — *not* all the way to `trunkTop`. The top is
6 m up under the rails; a collider running the full lean would block ground a
child can walk on with nothing overhead, and `keepOutsFor` owns that ground.
So: foot → the post's position at the tallest child's height, spaced finely
enough that the chain has no waist (r/2 spacing gives a 8 mm waist on a 0.272 m
radius).

**And the assertion.** Session 4 moved the leg invariant midpoint→foot, which
fixed the *collider* question and left the **mesh-versus-collider** question
unasked — and it is now answerable "no". The new invariant must ask: is the
drawn post, at every height a child can touch, inside a collider? That is the
one that would have caught this.

## Also requested

- **Must-fix comment**: `buildTreeline`'s claim that *"the RNG stream is
  untouched and every tree that is not in the road stands where it did"* is
  **false** — the `continue` sits above six `rng` draws. Measured: 436 vs 494
  trunks (so 58 felled is right), but **only 115 of 436 survivors stand where
  they did**, diverging from the second tree. Cosmetic in effect. The same
  sentence is already on `main` for the sibling clause — correct both.
- `isInEntranceRoad(x, z, radius = 0)` is `0 < 0`, false in the dead centre of
  the road.
- Orphaned `ENTRANCE_ROAD_OUTSET` comment in `roadRoute.ts`.
- `Entrance.ts`'s "kerb's length is measured" block still describes the deleted
  straight-kerb algorithm.
- `CORRIDOR_SAMPLE_SPACING` is 0.2 under a comment saying "a quarter of a metre".
- Two dead exports.
- **PR body is stale**: says "not mergeable, coplanar red" (green locally and in
  CI), "38400 road triangles" (now 81008), "81.6 m from the gate" (measured 79.5).

## What survived attack (verified by mutation, not reasoning)

The impossibility argument holds and is *understated* — excluded band
(1.93, 11.07) against an allowed [3.89, 8.11]; the doc's 4.4 m should be
**4.57**. The facing clause fires hard (4544 of 5216 triangles down under
mutation, 0 unmutated). **`check:cat-bus` did not define a defect away**:
renaming the three `entrance-gateway-path*` meshes gives exit 1 with all three
clauses firing, the old question still asked verbatim and still failing — only
*which meshes count* changed, because the surface was renamed. The rebase is
clean: the three dropped imports serve only main's `kerbReach` and `halfBus`,
both replaced here, and `gateArch.ts` is byte-identical, so #482 is intact.

## Blocker fixed, with the assertion that would have caught it

`addPostCollider` (`track.ts`) walks the lean; new invariant **"every Rail Race
post is solid all the way up a child"** asks the mesh-versus-collider question
the foot-only clause could not.

- Green: **576 passed**, 0 skipped (was 571 — one new invariant x 5 seeds).
  Coverage note on every run: `[post solidity] 49-50 walk-past posts, 4-5 of
  them leaning, swept to 2.97 m at 0.05 m`, and it says **"asserts nothing
  beyond the foot"** on a seed where none leans. The 4–5 leaning independently
  reproduces the reviewer's count.
- **Proved red** by reverting the collider to a single circle at the foot, at
  this branch's geometry (road outset 8.26, corridor honoured):
  `5 failed | 571 passed`, posts drawn **1.82–2.14 m outside anything solid**
  at ~2.93 m up. Worse than the review's 0.30–0.91 m because that was measured
  at 1.4 m and this sweeps to `TALLEST_CHILD_HEIGHT` (2.97).

### Still to do from the review

1. **Must-fix**: `buildTreeline`'s false "RNG stream is untouched / every tree
   stands where it did" comment — `continue` sits above six `rng` draws; 436 vs
   494 trunks, only 115 of 436 survivors unmoved. Same sentence is on `main`
   for the sibling clause; correct both.
2. `isInEntranceRoad(x, z, radius = 0)` is `0 < 0` — false in the dead centre.
3. Orphaned `ENTRANCE_ROAD_OUTSET` comment in `roadRoute.ts`.
4. `Entrance.ts`'s "kerb's length is measured" block describes the deleted
   straight-kerb algorithm.
5. `CORRIDOR_SAMPLE_SPACING` is 0.2 under a comment saying "a quarter of a metre".
6. Two dead exports.
7. **PR body stale**: "not mergeable, coplanar red" (now green, CI too),
   "38400 road triangles" (now 81008), "81.6 m from the gate" (measured 79.5).
   Also the impossibility doc's 4.4 m should be **4.57**, and the excluded band
   is (1.93, 11.07) against an allowed [3.89, 8.11].

`check:rail-race`, `check:entrance-road` and full `check` have **not** been
re-run since `addPostCollider` landed — a new collider chain can move
`keepOutsFor` ground, so those are the ones that matter next.

---

# Session 6: the corridor clause was nearly inert

Model: **Opus 5 (1M context)**. Head `de3778df`. **`check:entrance-road` is RED
on 12 of 16 seeds — deliberately, and not finished.**

## The finding of the night

`groundIsClear` asked `isInEntranceRoad` at the leg's **foot**, and
`check-entrance-road.mts` swept the bus against the leg's **foot**. Two
definitions of "where is this leg", both wrong the same way, agreeing with each
other on every run. Measured with the check fixed to sweep posts:

```
                     real park   corridor OFF
posts in the bus       8-9          8-10
of them walk-past      3-4           4-5
```

**The clause this whole branch is built around was removing about one post in
nine.** A nudged post keeps its top under the rails while its foot moves, so
moving the foot out of the road leans the post straight back in.

**Withdraw the earlier claim** in this handoff that the control at "151 legs"
proved the check discriminated. Both arms shared the fault; it measured nothing.

## Done this session

1. `check-entrance-road.mts` sweeps each post every 0.25 m of its length over
   the heights the bus body occupies (`CAT_BUS_BODY_BOTTOM_Y`/`_TOP_Y`, newly
   exported from `catBus.ts` so the span is asked of the bus), radius tapering
   as `addPostCollider` does.
2. It counts **distinct posts over the whole run**, keyed on post identity and
   split by ring. The first attempt summed per-station counts and gave 66-79,
   which is a station-sample sum and **not** a post count — do not quote it.
3. `postClearsEntranceRoad` in `track.ts`: `groundIsClear` now tests the whole
   lean. The top is asked of the route and is knowable at test time because no
   nudge moves it. **8-9 -> 0-5 posts, 3-4 -> 0-2 walk-past.**

## What is left, in order

1. **Finish the backtrack.** Still 0-5 posts on 12 seeds, worst 1.78 m. The
   search exhausts `RADIAL_NUDGES` and settles for the last candidate rather
   than trying a different decision — a wider search, a different arc slot, or
   a real fallback. **Not a clamp** (CLAUDE.md, "Procgen backtracks on
   collision, always").
2. **Post positions move now that the clause works.** Leg counts already shifted
   (1237 -> 1128 on the canonical seed). Hash the ring's post positions per seed
   before/after and state plainly in the PR which seeds moved and by how much —
   a park change that was invisible while the clause was broken.
3. **Write the inert-clause finding into the PR body** as prominently as the
   fix, so nobody trusts a green `check:entrance-road` for the wrong reason.
4. `roadRoute.ts:84-86` claims `check-entrance-road.mts` calls
   `IsoCamera.frustumBase()`. **It does not** — `frustumBase` is nowhere in that
   file and `entranceRoadReach()` goes into `report.reach` unread. Wire it up
   (Jim asked for that reach) rather than delete the claim.
5. Stale text: PR body Gates section (18 files/526 tests -> 19/581, and this
   round unmentioned); the orphaned `ENTRANCE_ROAD_OUTSET` docblock;
   `Entrance.ts` says the length comes from `TERRAIN_APRON` when it is
   `CAT_BUS_LENGTH + 55`; `roadRoute.ts:224` says "about 83 m" where
   `entranceRoadReach()` gives 79.5.

## The lesson I owe this file

I reported "0 stale claims remaining" after verifying by **grepping for the
strings I had just changed** rather than re-reading what the sections asserted.
Six were sampled in review; two were wrong and three items were not done at all.
That is a check that cannot fail, written by me, about my own work — the same
disease this file documents everywhere else. **Verify a claim about a document
by re-reading the document, not by searching for the words you edited.**

---

# Session 7: the residual was never a search failure

Model: **Opus 5 (1M context)** — matching the agent I replaced, per CLAUDE.md's
"a replacement runs the same model". Worktree `.claude/worktrees/road-seams-498`,
detached on `origin/fix/road-487-488`; pushes go
`git push origin HEAD:fix/road-487-488`. Rebased onto `origin/main` `c95facf6`
(#508 in), clean, no deletions.

## Correcting the previous session's item 1

It said the search *"exhausts `RADIAL_NUDGES` and then takes the last candidate
anyway"*. **It does not.** `searchForClearGround` returns `null` and
`trestleSpots` only pushes `if (placed)` — there is no settle-for-the-last-one
path, and every one of the three attempts passes `route`, so all of them honour
the corridor. Do not go looking for that code; it is not there.

## What the residual actually was: a third copy of "where is this leg"

`postClearsEntranceRoad` **restated** the trunk's top as the mean of the four
lane heights. The drawn trunk stops a whole `forkPlan(...).fork` lower, under
the branches. The road test walks the post only as far up as there is bus to
hit, *as a fraction of its rise* — so believing the post rose further than it
does made that fraction too small. It checked the bottom of a lean and passed
posts whose top third stood in the bus.

Measured, seed 11, `scripts/probe-post-lean.mts` (committed):

```
post          reach   at up   drawn rise   horiz lean   foot outside corridor
race:33        1.78    3.38         3.47         6.00                    3.17
race:34        1.63    3.91         4.03         6.00                    3.28
race:35        0.64    3.91         4.47         4.00                    2.11
walk-past:33   0.25    3.96         5.28         6.00                    3.22
```

The feet are 3 m clear. The posts lean six metres back over the road.

**Fixed by making one owner** — `TrestleTree` / `trestleTreeAt` in `track.ts`.
The draw loop, `addPostCollider`'s caller and `postClearsEntranceRoad` all now
ask it. That is the **third** instance of "two definitions of where this leg is"
in this one mechanism, which is why the owner's doc comment says so at length.

`check:entrance-road`: **exit 0, 0 posts in the bus on all sixteen seeds**,
control still 8–10 posts a seed. No wider search, no different arc slot, no
fallback — the search was fine, it was being told to search for the wrong post.

## But `test:procgen` is now RED, and it is the real finding

**exit 1, 7 failed | 574 passed.** (The background-task notification said
"exit code 0"; that was my `echo` wrapper's status, not the run's. Read the log.)

```
canonical  the widest run between consecutive trestle legs on the walk-past ring is 61.0 m (after leg 34), over the 40 m tolerance
seed 5     61.1 m (after leg 34)
seed 11    63.7 m (after leg 32)
seed 24    64.1 m (after leg 34)   + racers meet 10/10/9/10 duck bars
seed 131   62.8 m (after leg 34)   + racers meet 10/9/9/8 duck bars
```

And the trestle search now warns on **14 of the 16 seeds**, 3–5 slots each:
*"no clear ground found for the mandatory trestle at slot N even after the wide
search — a duck bar is scheduled here with no visible support"*.

So the honest state is: with the clause finally testing the post that is drawn,
**the ride cannot find ground for about five consecutive slots** where the road
runs alongside it, and it is dropping the legs rather than deciding differently.
*That* is the CLAUDE.md backtracking violation, and it is a different one from
the one the last handoff described.

Next: measure whether any foot position clears at those slots — sweep `dr` and
`da` at a failing slot and record which clause refuses each candidate. That
decides between "the search needs to be cleverer" and "the geometry is
impossible and the trestle's own shape has to give".

**Do not weaken the 40 m tolerance or the duck-bar fairness assertion.**
