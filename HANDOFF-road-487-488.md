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
