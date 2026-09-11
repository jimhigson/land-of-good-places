# HANDOFF — the arrival camera faces the bus doors, then travels with her

**Model: Opus (`claude-opus-5[1m]`), chosen by the Overseer as the Engineer
default.** A replacement must run the same model.

Branch `feat/sphere-combined`, worktree `.claude/worktrees/sphere-combined`.
Dev server **port 5391** (`vite --port 5391 --strictPort`, PID in
`/tmp/claude-501/vite5391.pid`). Jim has suspended checks, gates, CI and PRs
for this work — do not add any back without being told to.

## The links

- `http://localhost:5391/arrive?at=stepping-down` — **outside the bus, facing
  its open doors**, from the first frame. She comes down the step, the other
  children follow, then the camera travels with her under the arch and settles
  onto the ordinary park camera. About nine seconds; reload to watch again.
- `http://localhost:5391/arrive?at=doors-opening` — the same, one beat earlier,
  opening on the door still shut.
- `http://localhost:5391/arrive?at=walking-in` — opens on the travel beat,
  behind her walking under the arch.
- `http://localhost:5391/arrive` — unchanged: the full twenty-second loading
  ride, then the arrival.

## The finding that mattered most

**There are two cat-bus sequences and four rounds of feedback conflated them.**

- `BusJourney` (`src/world/entrance/BusJourney.ts`) is the **loading screen**:
  an interior shot of a bus full of children, `MIN_LOOP_SECONDS +
  SETTLE_SECONDS` = **20 s whatever the machine**, while the park generates.
- `ArrivalSequence` is the **arrival**: the bus pulling up at the gate. It is
  the thing `?at=` names, and `runTo` has always landed on a beat instantly.

Every *"close-up of her face between seat backs"* reported on this workstream
was the **loading ride**, not a camera anybody had aimed. Nobody had seen the
arrival camera at all.

## What changed

1. **`main.ts`** — `/arrive?at=<beat>` no longer takes the ride. It goes the
   route `/spawn` goes: park built behind the ordinary boot splash, straight to
   `finishLaunch`, `arriveByBus` still true so `Entrance` builds the arrival for
   `fastForwardArrival`. **4.4 s to the park, measured — the same as `/spawn`,
   which is the floor.** No frame of the bus is ever drawn.

   *Shortening the ride was built and measured first and reverted*: with both
   its minimum waits dropped and nothing drawn it still took **14.8 s**, because
   its import ladder loads one module per frame by design and no frame budget
   can make that quick.

2. **`ArrivalSequence.arrivalShot`** — the door beat now sets
   `watchesTheDoor: elapsed < AT_WALKING`, so the camera orbits **`doorFocus`**
   (the drop on the pavement) rather than the player. She is *aboard the bus*
   for the whole of that beat — measured at its first frame she stands at
   (1.07, 78.43) while the shell is centred at (-2.56, 78.94) — so orbiting her
   aimed the lens into the vehicle at any stand-back. That was the bug.

3. **`arrivalDoorYawDegrees`** — rewritten to the bearing straight out of the
   bus's own door flank: the world direction of bus-local
   `(sign(CAT_BUS_DOOR_DROP.x), 0)` under the road facing at the stop, read as a
   `cameraOffset` yaw. The old square-on-to-the-gate solve was **20° off the
   flank** on the canonical seed and put the bus's front corner across frame.

4. **Pitch 0 → 9°, stand-back 12 → 6.5 m** (`ARRIVAL_DOOR_STAND_BACK`), both
   judged off the rendered frame.

5. **The travel beat homes the bearing first and the stand-back second**
   (`yawHomeT` over the first 45% of the walk, `poseHomeT` from 35% to
   `ARRIVAL_CONTROL_AT`). Homing both on one curve put the eye far out on a
   bearing that is neither the door's nor the rig's, **and the park's furniture
   is only ever arranged to be seen from the rig's** — measured at t = 7.3 s the
   whole frame was the blue flank of a shop unit with the child not in shot.

6. **`Game.ts`** snaps the *focus* as well as the pose on the frame the shot
   engages. Otherwise the opening frame swings from the player to the drop —
   the swoop Jim already ruled out, one field along.

Deleted as dead: `ARRIVAL_BUS_PITCH_DEGREES`, `ARRIVAL_YAW_HOME_SECONDS`,
`ARRIVAL_DOOR_THREE_QUARTER_DEGREES`, and `ARRIVAL_DOOR_ZOOM` with
`ARRIVAL_CLOSE_FRAMING_AIR` (the last two were reachable only from a doc
comment — the "close framing" zoom was never applied to anything).

## Measured, on the running game at 1900×1000

`PerspectiveCamera` throughout. Sampled every 0.5 s from `?at=doors-opening`:

```
t=4.11  eye (2.4, 1.2, 68.7)  fov 69.4   the door shot
t=4.61  eye (2.4, 1.2, 68.7)  fov 69.4   identical — it opens on its framing, no dolly
t=6.12  eye (7.0, 0.0, 70.2)  fov 71.1   walking with her, bus behind
t=7.63  eye (21.5, 9.6, 80.7) fov 18.1   through the arch, drawing back on the rig bearing
t=10.14 eye (48.0, 55.4, 101.5) fov 9.5  the rig exactly
```

## The check

`check:arrival-camera` was **re-read, not deleted**. Every clause that only held
for the old orthographic, zero-pitch, fixed-stand-back shot is struck (the file's
own header lists which and why); what is left is Jim's sentence, one clause each,
plus the two that are not composition — the bearing is home when she takes the
controls, and the lens is never in the ground.

The square-on clause had to be **rebuilt out of world points off the standing
bus** (new export `arrivalBusPointWorld`). Asking `arrivalDoorYawDegrees`
whether the shot agrees with it is a tautology, and it was proved so by
mutation: adding 20° inside that function moved the shot and the expectation
together and the clause stayed green.

**Ten mutations proved red**, with the geometry they were proved against, in the
check's own docblock — plus **two that did not reach a clause**, recorded there
as the honest measure of how much slack each has. `20 checks, exit 0` on all ten
pool seeds.

## Widened past one seed

`LGP_SEED=<n> pnpm run check:arrival-camera` on every seed in `PARK_SEED_POOL`:
all ten exit 0.

**With a control on the instrument first**, because the numbers barely move
between seeds and that is exactly what a seed pin that is not reaching the
module looks like. The control shows it is:

```
LGP_SEED=20260728  PARK_SEED=20260728  drop=(0.95,74.95)  busOrigin=(-2.57,78.94)  doorYaw=167.33
LGP_SEED=128       PARK_SEED=128       drop=(1.61,75.84)  busOrigin=(-2.36,79.37)  doorYaw=160.24
LGP_SEED=451       PARK_SEED=451       drop=(-2.17,77.24) busOrigin=(-2.11,82.55)  doorYaw=-150.69
```

A 42° spread of door bearing across three parks, and the shot follows it. The
two numbers that *are* constant across seeds — the eye 11.0820 m off the bus's
axis, square-on to 0.0000° — are constant **because they are facts in the bus's
own local space**: the drop's offset from the axis plus the stand-back's ground
run. That is the right answer, not a stuck one.

## Gates

| gate | exit |
|---|---|
| `pnpm run build` | **0** |
| `pnpm run test:procgen` | **0** — 19 files, 601 tests |
| `pnpm run check:swept-bus` | **0** |
| `pnpm run check:park-pool` | **0** |
| `pnpm run check:coplanar` | **1 — INHERITED RED, see below** |
| `pnpm run check` | **0** — the whole 65-step chain, and `check:arrival-camera` ran inside it |

**`check:coplanar` is red and it is not this work.** Four findings, all on
bridge / boundary-wall / rail-fence geometry:

```
MORE:  garden|park-train/railway-bridges/bridge/deck|…/bridge/shell        2 seams, recorded at 1
WORSE: garden|garden/boundary-wall/boundary-blocks|park-train/rail-fence/… 0.280 m², recorded at 0.051 m²
MORE:  garden|garden/boundary-wall/boundary-blocks|park-train/rail-fence/… 2 seams, recorded at 1
NEW:   garden|…/bridge/shell|…/bridge/wallTop                              0.052 m², seed 326
```

**Proved inherited with a control**, not argued: a detached worktree at
`d1a2055a` — the commit before any of this work — produces those four findings
**byte for byte identical** (`diff` of both reports: no output). This branch is
`feat/sphere-combined` and carries several other workstreams (the road route,
the gate arch, the rail race, the railway bridges); those seams belong to
whichever of them placed that geometry. CLAUDE.md's zero-tolerance rule means it
has to be fixed before this lands — it is reported up rather than silently
fixed, because nudging someone else's bridge apart is exactly the fix
ART_DIRECTION.md §7 forbids, and deleting the right hidden face needs whoever
owns that geometry.

## Still unproven

- **The browser measurements are one seed only.** The ten-seed sweep above is
  of the *declared* shot. What `IsoCamera` realises from it was watched in a
  real browser on one park; the check says on every run that it cannot see that
  gap, and a five-day fault once lived in exactly it.
- A lamp post beside the gate crosses the lens briefly during the travel beat
  (visible around t = 7.3 s). Real park furniture, not a camera fault, but worth
  a look if Jim mentions it.
