# HANDOFF — cat bus #364 (wheels 2x, tiger stripes, suspension bob)

Branch `feat/cat-bus-364`, worktree `.claude/worktrees/eng-364`, base `origin/main` (b0390d9).

## The ask, with both corrections applied

1. **Wheels DOUBLE (2x) their current size** — corrected from the issue's original
   "50% larger" by Jim via the Overseer. Do not quietly shrink toward 1.5x.
2. **Tiger stripes on the BODY, not the wheels** — Jim resolved the ambiguity;
   the default assumption was right.
3. **A suspension bob while driving** — driven by speed/accel/cornering/road, not
   a fixed sine. Passengers must bob with it.

## Measured facts about the bus as it stands (all in the bus's own local space, y=0 is the road)

Run `scripts/tmp-measure.mts`-style dump if you need to re-derive. Numbers from
`origin/main`:

| thing | value |
| --- | --- |
| `BODY_BOTTOM_Y` (underside) | 0.62 |
| `CAT_BUS_FLOOR_Y` (walking surface) | 0.794 |
| `CAT_BUS_SEAT_Y` | 1.094 |
| `WINDOW_SILL_Y` (top of solid lower shell) | **2.13** |
| `WINDOW_HEAD_Y` / `CAT_BUS_CABIN_CEILING_Y` | 3.518 |
| body half-width (`BODY_WIDTH/2`) | **2.64** (outline shell reaches 2.68) |
| cabin inner wall (`BODY_WIDTH/2 - WALL_THICKNESS`) | **2.48** |
| glass panes | x 2.51..2.61, y 2.10..3.50 |
| cushions reach out to | x 2.07 |
| `CAT_BUS_LENGTH` / `CAT_BUS_WIDTH` / `CAT_BUS_TOP` | 15.83 / 5.28 / 5.21 |
| **current** `WHEEL_RADIUS` = `BODY_BOTTOM_Y * 0.86` | **0.5332** |
| current wheel box | x 2.16..2.90, y 0.01..1.05, width 0.746 |

## The fit problem at 2x, with numbers

At 2x, `WHEEL_RADIUS` = **1.0664**, so a wheel resting on the road tops out at
**2.133 m** — which is **level with the window sill at 2.13 m**, i.e. exactly at
the glazing line, with 3 mm to spare and nothing left for a bob.

Worse, at the *current* lateral position the wheel's inboard face is at x 2.16,
which is **inboard of the cabin's inner wall at 2.48**. At the current 0.53 m
radius the wheel only reaches y 1.05 and stays buried in the solid lower shell.
At 1.07 m it reaches 2.13 — so a black cylinder would rise **1.34 m above the
cabin floor, 9 cm outboard of the cushions**, standing inside the bus next to the
passengers. The ride's interior camera looks straight at that.

**Raising the ride height is not the answer**: the sill is derived from
`BODY_BOTTOM_Y`, so `sill - wheelTop = BODY_BOTTOM_Y - 0.62` — to buy 0.5 m of
arch you must raise the boarding floor by 0.5 m too, and the brief explicitly
protects boarding height. To put the wheel top under the *floor* you would need
`BODY_BOTTOM_Y ~= 1.96`, a chest-high step for a 2.12 m child.

## Chosen design

**Wheels move outboard, entirely clear of the bodywork in x.** Inner face of each
tyre sits outboard of the outline shell (x > 2.68), so it can never enter the
cabin and can never stand in front of a pane of glass, at any bob pose — the
clearance is guaranteed by lateral separation rather than by a height that a
downstroke can eat. Boarding, floor, seats, door and route are all untouched.

To stop that reading as a detached wheel:
- a short **axle stub** from the flank to the hub;
- a **fender arch** over each wheel, mounted on the *chassis* — so the bob really
  does close the gap between fender and tyre, which is the thing the check
  measures.

**Suspension**: wheels move to their own `axles` group parented to `root` and stay
planted on the road; the `chassis` (which already parents `cabin`, the seats and
therefore every passenger) heaves, pitches and rolls on a spring-damper. So
passengers bob with the bus for free — no second formula tracking the first.

Forcing terms: a road-bump profile sampled at **distance travelled** (so bumps
stop when the bus stops, and the rear axle hits the same bump the front one did,
one wheelbase later); longitudinal acceleration derived internally from d(speed)/dt
(squat/dive); lateral acceleration from yaw rate x speed, read off `root.rotation.y`
frame to frame (roll). All three outputs are clamped to published maxima so the
check has a real, enforced bound to assert against.

**Track width**: the vehicle is now wider than its bodywork. `CAT_BUS_WIDTH` keeps
meaning the bodywork (its docblock is emphatic about that); a new
`CAT_BUS_TRACK_WIDTH` is the overall figure, and `road.ts`'s `ROAD_HALF_WIDTH` and
`arrivalSightline.ts` take that instead.

**Stripes**: painted into the bodywork's own UV space via a world-scale "drape"
unwrap — u runs along the bus, v runs from the spine down over the roof and flanks
— so one tiling canvas texture covers the lower shell, upper shell, pillars, back
wall and door with stripes at a single consistent world size and no second mesh.

## State — complete, PR raised

- [x] Worktree + `npm ci`
- [x] Measured the bus, diagnosed the fit problem
- [x] Wheels 2x, outboard on stub axles, chassis-mounted mudguards
- [x] Suspension bob: two corner springs on `axles`/`chassis`, passengers ride for free
- [x] Tiger stripes, drape unwrap
- [x] `scripts/check-cat-bus-suspension.mts`, proved red five ways
- [x] `npx tsc --noEmit`, `npm run test:procgen` (443/443), `npx vite build`
- [x] Screenshots on `qa-screenshots` under `cat-bus-364/`
- [x] PR

## Things a successor should know

**`check:park-boot` is flaky on this machine and it is NOT this branch.** Run
four times on an unmodified `origin/main` worktree it gave 17.9 / 18.4 / 18.8 /
**28.7** ms against a 21.6 ms ceiling — the same distribution as this branch's
18.2 / 21.4 / 25.9 / 31.5. It is a wall-clock perf assertion on a box running
several agents at once. Everything else in `npm run build` passes, including
`vite build`. Worth its own ticket.

**Four real faults were found by writing the check, not by reading the code:**

1. The mudguard began as a half-`TorusGeometry`. A torus's tube must be at least
   half the wheel's width (0.36 m) to cover the tyre, and the arch gap is
   0.35 m — so its innermost surface sat 0.12 m *inside* the tyre, at rest.
   Rebuilt as an arc of flat plates whose inner faces are at a fixed radius by
   construction.
2. The cat's chin hangs to y = 0.14 m, 7.86 m forward of centre. A nose-down
   bump put it 0.16 m **under the road**. Fixed by `CAT_BUS_RIDE_LIFT`, derived
   from the three travel limits at that point — the ride height doubled wheels
   actually buy. It is applied to the chassis, so nothing in the bus's own space
   changes; what does change is the step down to the pavement, 0.51 m -> 0.78 m.
3. `ROAD_HALF_WIDTH` derived from `CAT_BUS_TRACK_WIDTH` gives a 9.75 m road and
   **the gate arch is 8.6 m** — five procgen seeds red. Reverted; the 7.25 m
   track fits the existing 7.78 m road with 0.26 m each side, now asserted.
4. Two faults inside the check itself: a wheel axis read off the wheel mesh's own
   frame (its local x is not its axle — it came out as world y), and a `Box3`
   round a spinning faceted cylinder, which wanders by `R*(sqrt(2)-1)` = 0.447 m.

**`check:cat-bus` needed teaching.** It asserted "the bus has exactly one painted
surface" as a proxy for "exactly one face", then took `painted[0]` as the face.
Striping the bodywork makes that proxy false — and `painted[0]` would then have
been a flank, with every face assertion below measuring the side of the bus.
It asks `isBakedFaceMesh` now, and still fails on any mapped mesh that is
neither the face nor a named striped panel.
