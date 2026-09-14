# What the radial sweep learned — for whoever builds the spherical domain

Jim stopped the instance-by-instance conversion on 14 September 2026:

> *"I don't think the mission has been taken on properly here — it seems more
> like trying to fit the new world into the old code."*

He is right, and this file exists because **the fleet was working at the wrong
layer but measuring the right world.** The patches are the wrong layer. The
measurements are not, and they cost five engineers a day to produce. Every
number below was read off the built park, not derived from a formula, and every
one of them will otherwise be re-derived by somebody in six weeks.

`RADIAL-INVENTORY.md` is the list of *sites*. This is the list of *facts*. Read
this one first: about two thirds of the inventory's rows collapse into three
sentences here, and the architect needs the sentences more than the rows.

---

## 1. There are only two mistakes in the entire inventory

The checks engineer's summary, and it is the single most useful thing in this
document:

> Every row is one of exactly two mistakes: **a `y` difference standing in for a
> distance**, or **a world `+Y` axis standing in for a local up**. A domain in
> which neither is expressible removes the category, not the thirty-two
> instances.

That is the design brief in two lines. Ninety-five sites, five engineers, one
day, and the whole thing reduces to those two. **If the new domain makes both
unrepresentable, none of the inventory needs porting** — which is the argument
for the redesign, made by the sweep that the redesign replaced.

## 2. Three quantities that are not interchangeable, and were treated as one

The sweep repeatedly went wrong by reaching for the nearest-looking helper. The
new domain should give these three separate names and separate types, because
every confusion between them cost a day somewhere:

| quantity | question it answers | cancels the planet when | gets it wrong when |
|---|---|---|---|
| **altitude** (`altitudeAt`) | how high is this above the ground *under it* | always, within one column | you difference two of them across columns |
| **walk height / radius** (`walkHeight`, `planetRadiusAt`) | how big is the step *between these two places* | both points in one column, or both on the ground | one point is in the air and the other beside it |
| **direction** (`upAt`, `tiltFor`) | which way is up *here* | n/a — it is a rotation | you try to fix a direction by moving a position |

Three worked failures, one per row:

- **Altitude differenced across columns.** Every `a.y − b.y` invariant where `a`
  and `b` are metres apart in plan. The radial gradient reaches **1.02 m of `y`
  per metre travelled outward** at the park's 157 m reach, so the difference is
  mostly planet.
- **A radius used where an altitude was wanted.** `topIsAbsolute`. Two points at
  the same world `y`, 1.3 m apart radially at 90 m out, differ by **0.54 m** of
  walk height. Measured consequence: a 1.1 m fence goes **ghost from 80 m out**
  when approached from the inward side. Live in the game today.
- **A direction treated as a position.** The effects engineer's `tiltFor` exists
  because `upFor` could not do the job: *"a launch vector, a squash axis and a
  spin axis are directions, and a direction cannot be fixed by moving it."*
  Positions map through the anchor; directions need the chart's rotation.

## 3. Solve flat, draw leaned — and exactly where it stops working

`drawnOnSphere` (`src/world/rail/sweptRail.ts`) already implements the pattern
the redesign is reaching for, and it works: a ride is **solved in the flat
authoring frame and drawn leaned**. `placeOnSphere` keeps the foot at its
`(x, z)` and re-lays the height along the local up — a unit vector — so a height
above ground and a gradient along the track are both *preserved exactly*.
Measured over the whole Sky Cruiser loop: flat `clearanceAt` and drawn
`altitudeAt` agree to **0.01 m at every sample**.

**So about twenty inventory rows were never bugs.** The solvers were right; the
bugs were all at the **consumers** — wherever a flat-frame quantity met drawn
geometry, or a vehicle or camera riding a drawn track was placed with flat Euler
angles. The cart was **10.83 m off its own rails at worst, 3.42 m mean**, around
a 213.5 m circuit, and that one root cause explained two separate QA regressions
(the cruiser through `castle-wall-lower`, and the rail-race rider's arm through
the cart side).

**Where the pattern stops, and it is a hard edge.** `placeOnSphere` preserves the
height but **does not keep the column** — it slides the point outward by
`height · sin(tilt)`. Harmless for a rider, because the rider is placed by the
same transform and cart and rail move together. **Not harmless for anything a
child stands on or is stopped by**, because those are keyed in the flat plan.
Measured on bridges, per-vertex: the parapet top moves **0.746 m** in plan at the
innermost crossing and **6.115 m** at the outermost, against a `PLAYER_RADIUS` of
0.62 m.

The general rule the new domain must encode: **a chart transform that moves a
point is safe for things that move together and unsafe for things that are
looked up by plan coordinate.** Which of the two a piece of geometry is, is a
property nothing in the current codebase declares.

## 4. Two definitions of a footprint, agreeing only because the world is flat

The bridge keeps its plan footprint twice, and the two agree today only because
nothing leans:

| definition | source | follows a leaned sweep? |
|---|---|---|
| `insideDrawnStone`, and the parapet **walls** | `shell.planEdge` — the polygon the sweep actually drew | **yes, automatically** |
| `platform.covers`, `deckCovers`, `bridge.covers` | the analytic `frame.project` and the planner | **no** |

**The one-owner fix runs toward the drawn sweep, not away from it.** My own
ruling on this said the tilt should be owned by the shared `SpineFrame` so both
definitions moved together; the bridges engineer checked and **`SpineFrame`
cannot carry it** — it is purely 2D (`worldAt` returns `{x, z}`, `project`
inverts `{x, z}` → `{along, across}`, no `y` anywhere), while a rigid tilt
displaces a point in plan as a function of its *height*. The workable direction
is the inverse: make all four footprint definitions read from `shell.planEdge`,
the polygon the sweep actually drew, which already produces the true answer and
which `insideDrawnStone` already follows. Recorded because the wrong version was
a lead's ruling and somebody would otherwise implement it.

So a leaned sweep would stop a child at the parapet in the right place and drop
her through the deck beside it — **silently, because each half stays
individually self-consistent.** Measured on today's flat code the two agree, so
it causes no present-day harm: 24 of 24 bearings marched at each of the
innermost and outermost bridge are stopped, and 125 of 125 points each bridge
claims to cover are carried. It is a latent bug, not one the sweep introduced, and it will survive into any new domain that does
not unify the two. `bridges.ts:892`'s own comment (*"taken from
`shell.planEdge` rather than re-derived from the frame"*) is the fossil of
somebody fixing half of it once already.

**Generalised: wherever geometry is drawn by one path and queried by another,
the flat world was hiding a disagreement.** Curving the world is what develops
the photograph.

## 5. A magnitude is not a signed height, and this repo is full of sentinels

`planetRadiusAt` is a distance, so it is never negative and **loses the sign of
anything below the planet's centre**. Two measured consequences:

- `walkHeight(100, -1e6, 100)` returns **+999560** — a point a million metres
  under the park reading as most of a million metres over it. Monotonic in `y`
  only for `y > -GROUND_SPHERE_RADIUS`.
- `+Infinity` and `-Infinity` **both** come back `+Infinity`. And the direction
  of that failure is the dangerous one. The collision engineer's worked case:

  ```
  gate:  if (moverUp < baseUp) continue;   // skip this collider
  +Infinity:  5 < Infinity  -> true   -> EVERY collider skipped -> NOTHING is solid
  NaN:        5 < NaN       -> false  -> no collider skipped    -> everything solid
  ```

  `NaN` would have been the *harmless* direction. `+Infinity` is a park a child
  walks straight through, and it typechecks. The call site was real:
  `Collision.ts` stores `baseHeight`, which **defaults to `-Infinity`** for every
  collider that does not declare a band — which is nearly all of them.

**For the architect this is not "guard the sentinel". It is: a domain type must
not let a sentinel through a magnitude function at all.**

## 6. The instruments were wrong more often than the code

This is the part that will repeat. Five of these, each clean, confident and
measuring something other than what it claimed. They are listed as *shapes*, not
as anecdotes, because the new domain will be measured by new instruments written
by somebody who has not read this.

1. **A test ledge built as `terrainHeight(x, z) + 0.70`.** Claimed a 0.70 m
   ledge; at 157 m it is **0.49 m** of real height, under the step threshold, so
   *both* the broken gate and the fixed gate passed it and the fixed one looked
   broken too. Build a test obstacle with `yAtAltitude`, never `terrain + h`.
2. **A probe that required both rays to hit before counting a point.** Silently
   discarded exactly the points where the two rays disagreed — the measurement
   it existed to take. A check that cannot fail, in probe form.
3. **`keepOutsFor(deck)` fed straight to `spaceAt`.** `keepOutsFor` returns
   **deck-local** coordinates, and `(19.2, 5.0)` is an ordinary patch of grass as
   well as a spot on the mall floor. All 351 points reported "in the garden" and
   the assertion under it failed by 2.32 m — which was the planet, measured
   somewhere the keep-out had nothing to do with.
4. **A reachability ring probe at 157 m.** Claimed to measure whether a collider
   was solid; actually measured the **soft boundary leash**, which shoves a mover
   16 m when the probe point falls outside the play bounds (the park's edge is
   not a circle). Gate every probe on `distanceToEdge` first.
5. **An interior reachability probe with its lattice centred on the park.** An
   interior point sat off the lattice entirely, where the router returns
   *unknowable* rather than *blocked* — and both read as a falsy `reachedGoal`.
   It failed three rooms **on correct code**.

6. **A solidity probe sampling from a fixed `ground + 6`.** The decks it was
   judging stand **4.73 m at the innermost crossing and 7.34 m at the
   outermost**, so it could not see the outer deck *at all*. It reported
   *"64 of 125 points the bridge claims to cover are NOT carried, worst falls
   8.87 m"* — a catastrophic-sounding present-day bug that **does not exist**.
   Sampling from `bridge.heightAt(x, z) + 2` gives 125 of 125 carried.

**And the sharpest lesson in this document is what number 6 says about numbers
1 to 5.** Its controls *passed*. They had caught that probe's previous fault and
they could not catch this one, **because the controls ran on open grass, where
there is no deck to be blind to.**

> A control proves the probe can produce **both verdicts**. It does not prove
> the probe can **see the object**. Both are needed, and only the second one
> requires the control to run against the thing under test rather than beside
> it.

Every "controls passed" in this sweep should be read with that caveat. The
engineer who found it had already retracted one number publicly and went looking
anyway; had they stopped at "controls passed" it would have shipped as a finding.

And the counterpart, which matters just as much: **reachability is almost never
the right question for a step gate.** Deleting a step test's correctness branch
outright left every route still succeeding, because A\* walks a staircase of
straight steps instead of the refused diagonal and arrives anyway. The route is
*blockier*, not absent. **On an eight-neighbour lattice, "can I get there"
detects a wall, not a broken gate.** Assert the gate's own number.

**A free instrument check nobody was using:** a quantity that must be
seed-invariant and is not. The swept-bus check's bus box varied by seed
(12.10 / 13.73 / 12.00 m long, floor 5 m underground) — and a bus model does not.
It costs one line to print and it catches a whole class.

## 7. Two traps in the tooling that are not about spheres at all

**The import trap, and the new domain walks straight into it.** A spherical
domain needs somewhere to ask *which chart is this point in* — which is exactly
what triggered this. `interact → spaces → building/layout → parkLayout`
(seed-dependent), plus a `building/layout → tapSpacing → interact` cycle. A
static import from `test/procgen` loads the park manifest **before the seed is
set**. Measured: base `49 failed | 269 passed | 279 skipped` in 88.6 s became
`132 passed | 465 skipped` in 2.6 s. **Zero failures, 137 fewer tests actually
run, nothing red.** The tell is the *pass* count, and it was caught only by
running the base as well. The duration collapse is a cheaper tripwire.

> Whoever owns the chart lookup must be reachable from `interact.ts` without
> dragging seed-dependent park data behind it.

**`rotation.y = yaw` is not "set the yaw".** It rebuilds the quaternion from all
three Euler components, so a tilt applied by pre-multiply is decomposed into
`rotation.x`/`.z`, read back next frame as intentional, and applied on top of
itself. Measured: a 10.5° lean became `rotation.x = -0.59` on the first frame
and `(1.11, 3.14)` a second later — the player was slowly tumbling, and the
first screenshot of it happened to catch her upright. Corollary nobody expected:
**`rotation.y = 0` is no longer "un-rotate"** anywhere a lean has been
pre-multiplied — it leaves the tilt in place. That is what made the swept-bus
baseline fiction.

## 8. Things that are true of the park and are not bugs to fix

Constraints the new domain has to *state*, rather than defects anybody should
chase:

- **The park outgrows its sphere.** Seed 11's furniture reaches **245 m on a
  220 m sphere** — past the equator, where the ground is vertical and then
  overhangs. "What is the park's maximum radius as a function of
  `GROUND_SPHERE_RADIUS`" is a domain invariant, not a check.
- **The day/night terminator does not exist.** One global `sunDirection`, and
  `sunUp` is its elevation above *the park origin's* horizon. On a sphere, `N·L`
  on the ground at 157 m goes negative whenever the sun is below 45° on that
  side, so for hours either side of noon the outer park is in real geometric
  shadow while the rig says broad daylight — lamps off, fog at day distances,
  bright sky over dark flat grass. A terminator is what a planet does. **This is
  Jim's call, not an engineer's.**
- **The indoor/outdoor seam is undecided.** `SPACE_CASTLE_ROOF` is "open to the
  sky", a child stands in it, wild pets live in it and the ginormous slide
  launches from it — and `spaceAt` calls it an interior because its origin is
  1341 m from the park's centre. The Sky Cruiser and the slide both *cross* the
  seam, and neither `coaster/**` nor `slide/**` mentions `spaceAt` at all. Nobody
  has decided what a child should see walking through that door. **Also Jim's.**
- **The hop's sideways half is not implemented.** Gravity is radial and works —
  apex **1.2267 m at every radius**, error 0.0000, against `1.28 · cos θ` before
  (0.90 m at the rim). But in her own frame the hop still leans toward the park's
  middle by up to **0.875 m** at the rim.

And one formulation lesson, which is a property of the maths rather than of
anyone's code: **the lateral half of a radial hop must be an integrated impulse,
never a re-derivation.** Re-deriving position from altitude
(`position = foot + up · altitude`) makes lateral position a function of
altitude, so the instant a surface drops away the mover is teleported sideways,
off the deck, which raises the altitude further and compounds.
`check:deck-fallthrough` went from green to **401 of 1280 runs losing the
surface** at gradient 0.1, with gaps reaching 50 m.

## 9. The park-build failure, and why a bisect could not name it

`check:park` and everything else through `park-harness.mts` died in `new World`
on *"rail crossings: the drawn paths cross the railway at railD 0.0
(0.0, 125.8), which snaps to no proven bridge site"*. It killed the park **in a
real browser too** — a blank blue screen on two seeds — not only headlessly.

**It was fixed** by the crossing engineer (PR #619, `eng/crossing-bridge`):
10 of 10 pool seeds build, up from 3. That unblocking took `test:procgen` from
**279 skipped / 269 passed to 0 skipped / 473 passed, exposing 81 previously
invisible failures**. Everything in the inventory recorded as "not measured, the
park does not build" is re-measurable now and **should be re-tried before anyone
trusts it**.

The reason it is in this file is the shape of the hunt:

- The inventory said the throw *"pre-dates all the sphere work — it reproduces
  at `db1363ce`"*. **`db1363ce` is itself a sphere commit**, so that was not a
  pre-sphere datum at all.
- A `git bisect` over the canonical seed named **`502ec802`**, a *merge* whose
  **two parents are both green on their own** — an emergent interaction, where
  the gate arch's new colliders moved the path router's answer.
- An independent walk named **`789d6088`** ("WIP: grow the park as the sphere
  shrinks — bridge planner does not"), with `check:park` exiting **0** at
  `db1363ce` and `6e1ebe9a` in between.
- `502ec802` **is** an ancestor of `db1363ce`. Both results are locally true.

So the failure is **non-monotonic in history** — broken, green again, broken
again — and `git bisect` assumes monotonicity. **It was the wrong instrument and
it returned a confident answer anyway**, which is this sweep's own lesson about
instruments arriving one layer further out than anyone expected. Neither commit
is "the cause"; there were at least two independent breakages of the same
symptom. A commit message on the branch asserts the opposite and is wrong.

---

## What I would tell the architect in one paragraph

Build the domain so that a `y` difference and a world `+Y` axis are both
unsayable, and two thirds of the inventory evaporates. Give altitude, walk
height and direction three separate names, because every serious bug the fleet
found was a confusion between two of them. Copy `drawnOnSphere`'s
solve-flat-draw-leaned pattern, which already works and is measured to 0.01 m —
but make a type say whether a piece of geometry moves with its transform or is
looked up by plan coordinate, because that distinction is what decides whether
the pattern is safe, and nothing declares it today. Never let a sentinel reach a
magnitude function. And assume the instruments are wrong: five of ours were,
each one clean and confident, and the only thing that ever caught them was
running a control first.
