# The sphere is the domain

**Status:** design, for the fleet to build. Not implemented. Written 14 September
2026 on `arch/sphere-domain`.

Jim's ruling, verbatim:

> *"I feel like this is not really addressing the issue of making a radial
> coordinate system, but just glossing over instance by instance. On a DEEP and
> FUNDAMENTAL level now, ALL rendering and ALL geometry is to be done using a
> layer to translate to orthogonal co-ordinates (from the radial space) only as
> the last step, while absolutely everything is calculated on a sphere - every
> spatial calculation, everything."*

And, when told the first draft of this reply looked like adapting the old code:

> *"this means a deep rewrite of much of the code to use new libraries for
> handling the new co-ordinate space"*
>
> *"I don't think the mission has been taken on properly here - it seems more
> like trying to fit the new world into the old code"*

So this document describes **the codebase as it would be if it had always been
spherical**, and only then how to get there. It does not try to preserve
`CollisionWorld`, `NavGrid`, the generators or the checks. Several of them die.

---

## The one-screen version

- **A position is a 3-vector from the planet's centre.** Nothing else is a
  position. There is no world `y`, and no `(x, z)` pair that means a place.
- **Flatness is a local privilege that must be declared.** A `Chart` is a patch
  with an origin, a validity radius, and a stated departure from the sphere over
  that radius. Working flat is allowed; working flat *without saying where and
  how far* is not, and is a check failure rather than a silent wrong answer.
- **The translation to Cartesian happens once, at scene-graph attachment** — an
  `Anchor` node — not at the render. Below an Anchor, three.js's own matrix
  composition is already correct tangent-space arithmetic.
- **Interiors are flat charts, by Jim's ruling, and that is the one exception.**
  It is bounded by the chart's validity radius, enforced by a check, and its
  cost is printed on every build so it cannot be forgotten.
- **A portal is an isometry between two charts**, and geometry may be instanced
  through one. That is what gives the ginormous slide, the sky cruiser and the
  roof garden a single owner for the first time.
- **The recurring defect** — one datum standing in for a quantity that varies —
  becomes unrepresentable, via two mechanisms in §7.
- **Cost: 9-11 weeks** wall-clock with a 5-8 agent fleet; ~47 agent-weeks.
  The game keeps working throughout except for a measured window in §9.

---

## 1. The decision already taken, and the arithmetic behind it

Before anything else, the fact the whole design turns on. I measured it rather
than assuming it (`R = GROUND_SPHERE_RADIUS = 220 m`; sag is the exact
`R − √(R² − (L/2)²)`, not the `L²/8R` approximation):

| flat thing | chord | departs from the sphere by |
|---|---|---|
| a castle floor plate (`INTERIOR_HALF_X` 21.2 → 42.4 m) | 42.4 m | **1.02 m** |
| a 60 m hall | 60 m | **2.06 m** |
| the interior plaza (`INTERIOR_PLAZA_RADIUS` 52 → 104 m across) | 104 m | **6.23 m** |
| the walkable garden (`GARDEN_PLAY_RADIUS` 135.4 → 270.8 m across) | 270.8 m | **46.6 m** |

**"Everything is on a sphere" and "interiors are flat rooms" are not
simultaneously satisfiable at R = 220 m.** There were three ways out — a
~2000 m planet, genuinely curved building floors, or interiors as a declared
exception.

**Jim chose: interiors stay flat and off-sphere.** The planet stays small, the
curve stays strong, and interiors are the single explicit exception to "no
exceptions whatsoever".

That ruling is why §5 — the seam — is the most important section of this
document, and why it is also the most likely place for the design to fall over.
A permanent flat/curved boundary at every doorway is not a compromise to be
hidden; it is a structural feature that needs an owner. It has never had one.

### How big a flat thing may be, at all

The same arithmetic run the other way, because it governs every decision in §3
and it is more restrictive than anyone has assumed:

| departure tolerated | largest flat patch (radius) | (diameter) |
|---|---|---|
| 1 cm | 2.10 m | 4.2 m |
| 5 cm | 4.69 m | 9.4 m |
| 10 cm | 6.63 m | 13.3 m |
| 20 cm | 9.38 m | 18.8 m |
| 1 m | 20.95 m | 41.9 m |

**On this planet, a flat patch is good to about 4.7 m at centimetre tolerance.**
That is a bench, a stall, a prop, a single stair tread — and nothing else.
Measured against real park features:

| feature | patch radius | departure |
|---|---|---|
| a bench or prop | 1.5 m | 0.01 m |
| a stall | 3.0 m | 0.02 m |
| a castle floor plate (half-diagonal) | 26.3 m | **1.58 m** |
| the ginormous slide, 68 m long | 34 m | **2.64 m** |
| a coaster loop, 220 m round | 35 m | **2.80 m** |
| a train loop, 400 m round | 63.7 m | **9.41 m** |
| the rail-race ring at its outer reach | 110 m | **29.47 m** |

**This is the finding that decides the whole design.** It means the curved chart
is not merely the principled default — it is the *only* option for anything
bigger than a piece of furniture. Every ride, every path, every route, the
railway and the park boundary must be genuinely geodesic; they cannot be
rescued by a local flat patch, at any origin, because no patch that contains
them is flat enough to be worth having.

It also shows how much work Jim's interior exception is doing: a floor plate at
1.58 m is **the largest flat thing the game is permitted**, and it is permitted
by ruling rather than by arithmetic.

### The lean, for reference

| d from origin | lean | `cos θ` |
|---|---|---|
| 0 m | 0.0° | 1.000 |
| 40 m | 10.5° | 0.983 |
| 80 m | 21.3° | 0.932 |
| 120 m | 33.1° | 0.838 |
| 135.4 m (garden edge) | 38.0° | 0.788 |
| 157 m (park's reach) | 45.5° | 0.701 |
| 219 m | 84.5° | 0.095 |

---

## 2. What the canonical coordinate is

**A position is a 3-vector from the centre of the planet.** Call the type
`Geo`. Three numbers, no chart, no singularity, no special cases.

```
type Geo = { readonly p: Vector3 }   // from the planet's centre, metres
```

It is deliberately *not* a `Vector3` — it is a distinct nominal type whose
components are not meaningful individually. `geo.p.y` is a component of a vector
from the centre of a planet; it is not a height, and nothing in the codebase may
treat it as one. Height is `radius(geo) − groundRadius(direction(geo))`, which
is a function call, and that is the point.

### Why this, and the failure mode of each rejected option

**Rejected: latitude/longitude + altitude.** It is the coordinate everyone
reaches for because it is the one they know from maps, and it is wrong here for
four reasons. It is singular at the poles, so a child walking over one gets a
yaw discontinuity and every bearing calculation flips. Every distance becomes a
haversine — transcendental functions in the innermost loop of collision, which
runs thousands of times a frame. Straight lines stop being straight: the
midpoint of two lat/lons is not their average, so *no* interpolation, damping,
or velocity integration can be written the obvious way, and every one of them is
written the obvious way today. And a rectangle in lat/lon is not a rectangle on
the ground, which silently breaks every footprint, keep-out and play bound. The
cost is paid in every loop for a convenience that only helps when printing a
position for a human, which this game never does.

**Rejected: a cube-face chart (six charts, seams at the edges).** This is what
Google's S2 does, and for *indexing* it is the right answer (see §6). For
authoring and physics it is not: it buys nothing for a park that occupies one
face, and it costs seam-crossing logic in every subsystem — exactly the class of
code that the doorway seam already shows us is where the bugs live. Paying that
cost six more times, for seams no child will ever be near, is a bad trade. If
the park ever wraps a whole planet, revisit this for the *index* only.

**Rejected, emphatically: today's `(x, z)` orthographic chart plus altitude.**
An engineer established that `(x, z)` is an exact, invertible orthographic chart
of the cap — tangential distances preserved, radial compressed by `cos θ`. Both
halves of that sentence matter, and the second half **is the bug**, not a
footnote to it. Measured:

| d | a 0.5 m lattice cell, tangentially | the same cell, radially | its diagonal |
|---|---|---|---|
| 0 m | 0.500 m | 0.500 m | 0.707 m |
| 80 m | 0.500 m | 0.537 m | 0.734 m |
| 135.4 m | 0.500 m | 0.634 m | 0.808 m |
| 157 m | 0.500 m | **0.714 m** | **0.871 m** |

`NavGrid`'s `MAX_STEP` is **0.62 m**. The outward diagonal beats it from well
inside the garden. That is not a lean a child can see — it is **tap-to-move
silently refusing to path outward**, in the part of the park where there is
nothing to blame. The chart's distortion and the defect are the same number.

The chart is also **singular at `d = R`** — 220 m today, and the park's
furniture already reaches 157 m. It cannot express a whole planet, and it is
within a factor of 1.4 of not being able to express the park. If Jim ever asks
for a child to walk right round — he has not, and this design does not assume it
— the `(x, z)` chart cannot do it at any price, whereas `Geo` needs no change
at all. That asymmetry is worth a great deal for free.

**Chosen: the planet-centred 3-vector**, because it is exact everywhere, has no
singularity, makes distance a subtraction and a `length()`, keeps interpolation
and integration linear (a straight line through the planet is close enough to a
geodesic at these scales, and where it is not, §3's charts are exact), and is
already the native currency of three.js and of every GPU matrix. The redundancy
— three numbers for two surface degrees of freedom plus a height — is the thing
that buys all of that, and it costs four bytes.

### Orientation is a frame, never a yaw

Half the defects in `RADIAL-INVENTORY.md` are not position bugs at all. They are
things placed with a *scalar yaw* and an implied `+Y` up: `rotation.x = -PI/2`
on a tap marker, `rotation.y = atan2(...)` on a cart, `arrive: { x, z, yaw }` in
the portal table.

So orientation gets a type too:

```
type Frame = { readonly at: Geo; readonly q: Quaternion }
```

and the only ways to make one are from a `Geo` plus a bearing *within a named
chart*, or from another `Frame`. **There is no global yaw**, because there is no
global north. A bearing is meaningful only relative to a chart, and saying which
chart is the whole discipline.

This single change retires the tap marker, the hop rainbow, the highlight ring,
the cart pose, the tie frame, the climb pose and the bus pose as a *class*.

---

## 3. Charts: flatness is a declared local privilege

The insight that makes the rest work:

> **Today's bugs are not "code that forgot about the sphere". They are all one
> bug: a *global* flat chart, used everywhere, that nobody ever declared.**

A hand-copied `deckY` across a whole fence run, a castle carve pinning one
height across ground that falls 14.6 m, gate corridor `z` coordinates copied
while the arch stood elsewhere — each of these is a flat chart of unbounded
extent, asserted implicitly. The code is not wrong about the sphere; it is
silent about its own domain of validity.

So make the domain of validity a first-class, mandatory, checkable thing.

```
interface Chart {
  readonly id: ChartId;
  readonly kind: 'curved' | 'flat';

  /** Where this chart's origin sits on the planet. */
  readonly anchor: Frame;

  /** How far from the origin this chart promises to be usable. Metres. */
  readonly validFor: number;

  /** Exact both ways, within validFor. Throws outside it. */
  toGeo(local: Vector3): Geo;
  toLocal(g: Geo): Vector3;

  /** The local up at a local point — the whole point of the type. */
  upAt(local: Vector3): Vector3;

  /** Metres by which this chart departs from the sphere at validFor. */
  readonly departure: number;
}
```

Two kinds, and only two:

- **A curved chart** is the planet itself. `toGeo`/`toLocal` are the exponential
  map and its inverse — geodesic polar coordinates about the anchor, exact, no
  approximation, no distortion, at any distance. `upAt` is the radial. `validFor`
  is the whole sphere and `departure` is 0. The outdoor park is one curved
  chart. **This is the default and the domain.**
- **A flat chart** is a tangent plane. `toGeo` is anchor-frame composition;
  `upAt` is the chart's own constant up. `departure` is the sag computed from
  `validFor` and the planet radius — the numbers in §1. Interiors are flat
  charts, by Jim's ruling.

### What this buys, precisely

1. **`validFor` is enforceable.** `chart.toGeo` of a point outside `validFor` is
   an error, not a wrong answer. A check (`check:chart-extent`) computes, for
   every chart, the furthest any consumer actually reads, and compares. A room
   that grows past its declared radius goes red at build time.
2. **`departure` is printed on every run.** Per CLAUDE.md's rule that a check
   which stops covering something must say so on every run, and to stderr:
   *"castle.hall is flat over 24 m; on R = 220 that departs from the sphere by
   0.33 m."* The exception Jim chose stays visible and quantified forever,
   rather than decaying into "flat because nobody converted it".
3. **Chart membership is carried, never inferred.** `spaceAt(x, z)` and
   `castleFloorAt(x, z)` — both documented as "purely positional", both
   load-bearing today — **die**. An entity holds its `ChartId`. This is not
   tidying: positional lookup is *the reason* interiors had to be pushed 300 m
   apart in the first place, and killing it is what lets them come back to
   sensible coordinates. There are only 21 call sites.
4. **A flat chart is a legitimate thing to want — but only at furniture scale.**
   A 3 m bench, a stall's counter top, a single stair tread: genuinely flat,
   correct as flat charts with a 2 m validity, printed departure under a
   centimetre. Per §1, that ceiling is about **4.7 m of radius** at centimetre
   tolerance, and it is a hard fact about this planet rather than a style
   preference. Anything larger is curved, or is an interior and therefore
   Jim's declared exception. The design does not moralise about flatness; it
   moralises about *undeclared* flatness, and the arithmetic does the rest.

### Fields: a quantity that varies over the surface

The second half of the defect class. Where code today captures a scalar and
carries it across a run:

```
type Field<T> = {
  at(g: Geo): T;
  /** The only way to make a constant one, and it must name its chart. */
  // Field.constantOver(chart, value)
};
```

A fence run does not carry `deckY: number`. It carries `ground: Field<number>`
and samples it per post. If it genuinely is constant — a bench on one flat chart
— it carries `Field.constantOver(benchChart, y)`, which is legible, bounded, and
goes red if the bench ever grows past `benchChart.validFor`.

There is no other constructor. You cannot get a `Field` from a single sample
without naming the chart over which you claim it is constant.

---

## 4. Where the translation layer sits

**The last step is scene-graph attachment, not the render.**

This is the sharp answer to Jim's "translate to orthogonal coordinates only as
the last step", and it is more useful than "at the render" because it puts the
boundary somewhere a check can stand.

```
class Anchor extends Object3D {
  constructor(frame: Frame);   // the one and only Geo → Matrix4 conversion
}
```

**Rule: nothing is ever added to the scene root with a computed world position.
Everything hangs off an `Anchor`.**

### Why this line and not the render

Because three.js's matrix composition *below* an Anchor is already exactly
correct tangent-space arithmetic. A model authored flat, with its own local
`rotation.x = -PI/2` and its own local offsets, is **correct without
modification** once its parent Anchor carries the geodesic frame. That is not a
theory: it is the observed difference between the two clearest cases in the
inventory.

- `src/world/LampPosts.ts:303` does `glowGeometry.rotateX(-Math.PI/2)` — a flat
  disc in the XZ plane — and is **correct**, because every instance goes through
  `instanceAt`, which calls `placeOnSphere` per lamp.
- `src/art/models/tapMarker.ts:57,61` does the identical thing and is **wrong**,
  because its root goes straight to the scene and callers only ever set
  `position`.

Same code, opposite outcomes, and the only difference is whether something
leaned it downstream. The Anchor makes "something leaned it downstream"
universal and mandatory, which retires roughly 90 inventory sites as a class
rather than as 90 individually-argued fixes. That is the difference between this
design and the day of work that prompted it.

### What lands on which side of the line

**Spherical side — everything reasons in `Geo`, `Frame`, `Chart`, `Field`:**
all generators and solvers; collision; navigation; player and NPC locomotion and
gravity; ride route solving; interaction zones, tap targets and keep-outs;
camera *targets*; lighting *directions*; every check and invariant.

**Cartesian side — plain three.js, and correct for free:**
mesh authoring and all of `src/art/models/**` (already local, already fine);
everything below an Anchor; skinning and animation; materials; the projection
matrix; raycasting (already orientation-free — the inventory confirms there is
no `intersectPlane` and no downward ground ray anywhere in `src/`).

**Straddling, and each needs an explicit decision:**
the camera rig (its target is a `Frame`; its own transform is Cartesian);
particles (emitted in a `Frame`, simulated in the emitter's chart, drawn below
its Anchor — which fixes the puffs, the sparkles, the dust and the spark burst
at a stroke); and the sky, which is per-chart and covered in §5.

### The check that holds the line

`check:anchor-discipline` — a static check over `src/` asserting that no
`Object3D` added to a scene root has a `position` assigned from anything but an
`Anchor`. Today there are 51 `scene.add`/`world.add` sites and 681
`.position.set(` sites; the great majority of the latter are object-local and
stay exactly as they are.

---

## 5. Interiors, and the seam

Jim ruled that interiors stay flat and off-sphere. This section is what that
costs and how it is paid.

### What an interior is

**A flat chart** whose `anchor` is a `Frame` **on the planet, at the building's
real location**, and whose `validFor` covers that interior and no more.

The chart's *geometry* still lives wherever is convenient. But note what the
chart type separates, which nothing separates today:

- **The geometric origin** — where the chart's local coordinates are realised in
  the renderer. May be anywhere. May even go back to being near the building,
  because §3's point 3 kills the positional lookup that forced the 300 m
  spacing.
- **The planetary anchor** — where the chart *is*, for the sun, the sky, the
  horizon, shadows, weather and the park map.

Today these are conflated, and that conflation is why the roof garden is a mess.

### The seam is a portal, and a portal is an isometry

```
interface Portal {
  readonly id: string;
  readonly a: { chart: ChartId; frame: Frame; trigger: Region };
  readonly b: { chart: ChartId; frame: Frame; trigger: Region };
  /** Can you see through it? Default false. */
  readonly transparent: boolean;
}
```

A portal is **defined by making the two door frames agree.** Given the doorway's
frame on each side, the portal is the unique rigid transform taking one to the
other. Everything follows from that one property:

> **A portal preserves everything measured in the local frame, and nothing
> measured in the global frame.**

That sentence is the design guarantee, and it is also the migration instruction:
any code that survives a portal is code that asks local questions.

**Note what this kills.** `ARCHITECTURE-DECISIONS.md` Decision 3's portal table
— which has not shipped — declares `arrive: { x: number; z: number; yaw: number }`.
That is the defect class of this whole document, sitting in the portal table
itself: a scalar yaw is meaningful only against a global north, and arriving in
the garden has no global north. **`arrive` must be a `Frame`.** It is a cheap
fix today and an expensive one in six weeks, which is why it is called out here
rather than filed.

### The four questions, answered

**A child walking through.** Her state is local: speed, heading relative to the
door, altitude above the floor. The portal is an isometry, so every one of those
survives exactly, and only her `ChartId` changes. Her *up* rotates — by up to
45° at the park's reach — and that is real and visible, so it is animated
through the existing iris rather than snapped. The iris already exists for the
teleport; it now also covers an orientation change, which is what it was always
implicitly doing.

**A pet following her.** A follower chases a target *in a chart*. When the
target crosses a portal, the follower's target is expressed **through** the
portal until the follower crosses too. Concretely: a path is a list of
`(chart, local points)` segments and **a portal is an edge**. This is precisely
Decision 11's shape — *"nodes are (cell, level), and a stair is an edge its own
plan declares"* — generalised one notch to *"nodes are (chart, cell), and a
portal is an edge its own plan declares."* Decision 11 survives intact; it was
right, and it was right for this reason.

**A camera that can see both sides.** Only through a `transparent: true` portal,
and then by rendering the far chart with the portal transform applied to the
camera. Almost every portal is opaque — a door into a room shows a room, and the
hotel works today precisely because you cannot see through it. Transparency is
opt-in, per portal, and costs a second render pass, so it is declared where it
is wanted and nowhere else.

**A slide that starts on a roof garden and lands outside.** This is the one that
has no owner today, and it needs a new concept:

> **Portal-instanced geometry.** A mesh may declare that it is visible in more
> than one chart. It is drawn in each, through the portal transform. Because the
> portal is rigid, the shape is identical in both.

The ginormous slide is therefore **one solved curve, drawn twice**: in the roof
chart for a rider standing at the top, and in the park chart — transformed
through the castle's portal — so that from the park it appears correctly
attached to the castle's roofline. Rider physics is continuous because the
portal is an isometry; the rider simply changes `ChartId` partway down.

The same mechanism carries the sky cruiser through the castle. The family asked
for it to fly *through* the building; today neither `src/world/coaster/**` nor
`src/world/slide/**` mentions `spaceAt` or any castle space — zero grep hits —
which is to say the seam is currently unowned rather than solved.

### The worked example: the roof garden

`SPACE_CASTLE_ROOF` is the hardest case in the game, and it is worth being
explicit that the design handles it, because if it did not, that would be the
headline finding.

The facts: `floors.ts` gives it `roofed: false`; it is *"open to the sky"*, with
the sun keeping its moving shadows and `InteriorLighting` staying off; wild pets
live there; the ginormous slide launches from it; and its origin is
`(1200, 600)` — **1341 m from the park's centre, on a planet of radius 220**,
where the radial formula is not merely inaccurate but meaningless. `spaceAt`
classifies it as an interior, so its up is plain `+Y`. That classification is an
accident of a radius test, not a decision anybody took.

Under this design it is a **flat chart with `roofed: false`**, and the pieces
fall out cleanly:

- **Its up is `+Y`** — correct, and now *because it is a declared flat chart*
  rather than because it fell out of a distance comparison.
- **Its sky, sun angle, shadow direction and horizon come from its planetary
  anchor** — the top of the castle, in the park — not from its geometric origin.
  This is the separation §5 opens with, and it is why the roof garden can be
  genuinely outdoors without being on the sphere.
- **The slide is portal-instanced**, so it is attached to the castle's roofline
  when seen from the park and rideable from the roof, with one solved curve.
- **Its `departure` is 1.02 m** over the 42.4 m plate, printed on every build.
  A roof garden that is flat to within a metre of the sphere it sits on is a
  perfectly reasonable thing for a castle roof to be — but it is now a stated
  number rather than an accident.

### Where this design is weakest — stated plainly

**A transparent portal between a flat chart and the curved park will not look
right at the edges, and no amount of design fixes that.** Inside the doorway the
world is flat; a metre beyond it the ground leans. The portal makes the *frames*
agree exactly at the threshold, so the seam is invisible at the door itself and
grows with distance from it. For a door into a room, this is free — you cannot
see far. For a wide opening onto the park from a large flat interior, it is not,
and the mitigation is to keep such openings narrow or keep such portals opaque.

This is the direct, unavoidable consequence of Jim's ruling. It is not a defect
in the design; it is the price of a small planet with flat rooms, and it should
be spent knowingly. The roof garden is the case most likely to expose it, since
it is open to the sky by definition — which is why its sky comes from a
planetary anchor and its *geometry* stays opaque to the park.

---

## 6. Libraries: what exists, and what is worth taking

Jim named this directly, so it was investigated rather than assumed. The repo
today has exactly two runtime dependencies — `three` and `workbox-window` — so
adding one is a real decision, not a shrug.

### What was examined, and why each fails

**Geodesy libraries — `geodesy`, `geographiclib-geodesic`,
`spherical-geometry-js`, `great-circle`.** These are mature, correct, and
answer a different question. They are lat/lon-on-Earth libraries for mapping and
navigation: distance between two GPS points, rhumb lines, ellipsoid corrections,
UTM. They **embed the coordinate system §2 rejects**, they work in kilometres on
an ellipsoid, and they have no notion of a frame, a tangent patch, a collider or
a scene graph. Adopting one would mean converting *into* lat/lon at the boundary
to use it — importing the singularity and the haversines this design exists to
avoid. Rejected on the merits, not on principle.

**Google S2 (`s2geometry`).** Genuinely excellent, and the closest thing to a
real answer. It is hierarchical spatial indexing on a sphere: a cube-face
projection plus a Hilbert curve, giving cell IDs that support fast region
queries and containment. Three problems here. The real library is C++; the
JavaScript story is explicitly the weakest of its ports and the npm packages are
unmaintained community work. It is built for Earth-scale region indexing with a
lat/lon API, not for a 220 m play park at centimetre precision. And its cell
hierarchy *is* the cube-face chart §2 rejected — fine for indexing, which is
what it is for, and wrong for authoring.

**HEALPix.** Equal-area spherical pixelisation for spherical harmonics, from
astronomy. Solves a problem this game does not have.

**Game engines.** The decisive datum. Unity's NavMesh, Unreal's navigation
system and the A* Pathfinding Project all assume a **fixed up direction**.
Every team that has shipped a spherical planet has written a custom navigation
and collision system, and the published accounts converge on the same shape:
make the representation orientation-agnostic (surface cells with neighbour
relations) rather than trying to teach a fixed-up system about gravity. **There
is no off-the-shelf spherical game-physics stack, in any engine.** That is worth
knowing before paying for one.

### The recommendation

**Take no new runtime dependency. Take one idea.**

- **Own the geodesic primitives.** Exponential map, logarithmic map, frames,
  great-circle steps, parallel transport: this is roughly 300 lines of
  well-understood mathematics with exact closed forms on a sphere. Owning it
  means it is tested against *this* park at *these* scales, it has the
  repo's own doc-comment discipline, and there is no impedance layer. This is
  not the reflexive not-invented-here answer — it is what the survey supports,
  and it is the same conclusion every shipped spherical game reached.
- **`three` is already the library Jim is asking for**, and it is
  under-used. `Quaternion`, `Matrix4`, `Object3D` parenting and the raycaster
  are all orientation-agnostic and all correct on a sphere already. §4's Anchor
  is not new machinery; it is using the machinery that is already there, on
  purpose, at one place.
- **Copy S2's design for the spatial index, without the dependency.** The one
  place a library would genuinely have earned its keep is broad-phase spatial
  queries on a sphere, which is real work and easy to get subtly wrong. A
  hierarchical cell index over the sphere — cube-face plus a space-filling curve
  — is the right structure, the algorithm is published and well documented, and
  implementing it against `Geo` directly is far less work than bridging an
  unmaintained port's lat/lon API. **Budget this as real work** (§10 does), not
  as a footnote: it is the piece most likely to be underestimated.

So: the honest answer to Jim's instinct is that he is right that this needs new
primitives, and right that the old code cannot be fitted to the new world — but
the primitives do not exist to be bought. Nobody sells them, because everybody
who needs them writes them.

---

## 7. What becomes unrepresentable

The brief asks for the recurring defect class — **one datum standing in for a
quantity that varies** — to be made structurally impossible, and says to state
how if it is. Two mechanisms, and they cover different halves.

**Mechanism 1: a chart must declare how far it is good for.**
Catches *reads*. Every historical instance of this defect is a flat chart of
unbounded extent, implicitly asserted: the gate corridor's copied `z`, the
fence's flat `deckY`, the castle carve's pinned height, `check-hotel.mts`'s
`FLOOR_OF_THE_WORLD = -2` constant that now fires on every NPC past 28.7 m.
Each becomes "a chart read outside its `validFor`", which throws. Not a wrong
answer that a child finds — an error at the call site.

**Mechanism 2: a constant `Field` must name the chart it is constant over.**
Catches *captures*. `Field.constantOver(chart, value)` is the only constructor
that turns a sample into a field. You cannot write `deckY: number` and carry it
along a run; the type will not let you, and the version that does compile says
out loud which chart it claims constancy over, bounded by that chart's own
`validFor`.

**What is not caught, stated honestly.** Neither mechanism catches a chart whose
`validFor` is simply declared too large. That is a human judgement, and the
mitigation is that `departure` is computed from it and printed on every run, so
an over-large claim is visible as a number rather than invisible as an
assumption. That is weaker than a type error and stronger than anything today.

**A third thing dies as a side effect:** there is no global `up`. `Vector3(0,1,0)`
appears 36 times in `src/` and in a long tail of checks, every one of which is
either an interior's up (now `chart.upAt`, correct and legible) or a bug. With
no global up in scope, the bug cannot be written.

---

## 8. Composing with the round-robin generation rewrite

`design/round-robin-generation` is in flight and Jim's standing ruling is that
Fable owns it. This design **composes with it and changes one thing in it**, and
the change is cheap now and expensive later.

Decision 12's substrate has generators claiming ground through a registry and
returning refusals rather than throwing, co-solving and backtracking across
frames. That architecture is orthogonal to this one — *what* a generator does is
unchanged; *what it says* changes.

**First, a correction to my own earlier advice, because the timing is worse than
I assumed.** The claim representation has **already partly landed on `main`**:
`src/boot/groundClaims.ts` (451 lines) shipped in #499, and `roadCorridor.ts`,
the first production placer built on it, shipped in #522. So this is no longer
"decide before it freezes" — part of it is frozen, and this is a migration.
The shapes as they stand:

```ts
export interface Disc    { shape: 'disc';    x, z, radius: number }
export interface Capsule { shape: 'capsule'; x1, z1, x2, z2, halfWidth: number }
export type ClaimKind = 'footprint' | 'corridor' | 'walkable' | 'surface';
export interface Refusal { readonly feature: string; readonly kind: ClaimKind; }
```

Every overlap test is plan-projected `Math.hypot` / `distPointSegment` /
`segmentsCross`, and `coreSamples` marches a capsule as a **straight line**.
There is no `y` in the claim model at all. Three consequences:

- **A claim must become a spherical region.** On the sphere, "a 4 m disc" is a
  region whose `(x, z)` footprint stretches by `1/cos θ` radially — 1.43× at the
  park's reach. A registry storing claims as plan discs **silently under-claims
  in the outer park**, and two generators get granted the same ground. A capsule
  must become a geodesic arc, because `hypot` between its ends stops being its
  length within a few tens of metres.
- **`CLAIM_COMPATIBILITY` and the refusal ladder survive untouched.** The law is
  exported data, the unwind ladder is sound, and none of it depends on the shape
  type. This is the good news: the expensive part of Decision 12 is not the part
  that has to change.
- **Refusals gain a reason this design already supplies** — "outside my chart's
  validity" — which is exactly the round-robin contract and exactly the
  backtracking CLAUDE.md's standing rule demands.

**Second, and this corrects an assumption in the round-robin work itself:**
almost no generator can use a local flat chart. §1's table shows a coaster loop
departs by 2.80 m, a train loop by 9.41 m, the rail-race ring by 29.47 m. The
survey of `rail/generate.ts` suggested its `CubicSegment`/`Pose2` types
(`{x, z, hx, hz}`, eight scalars, no `y`) could be reinterpreted as tangent-plane
coordinates *without changing the search*, provided the patch were big enough for
the route. **No such patch exists on a 220 m planet.** That route solver has to
become genuinely geodesic, and that is a real cost, accounted for in §10.

**Third, the single highest-leverage interface in the codebase.** The shared
route solver's brief takes:

```ts
readonly clear: (x: number, z: number, radius: number, distanceAlong: number) => boolean;
```

No frame, no height, no chart. **Four solvers close over this one callback** —
the coaster, the slide, the train and the rail race — each hiding its own height
assumption inside it. Changing this one signature to take a `Geo` reaches all
four at once. If any single edit is worth sequencing carefully, it is this one.

**Recommendation to the Overseer:** land the `Geo`/`Chart` types (Phase A)
before more placers are built on the flat `ClaimShape`. One placer exists today;
Decision 12's stage 3 adds several more, and each one built flat is another
consumer to migrate. The two rewrites are fully compatible — but the window
where this is cheap is measured in weeks and is already partly closed.

---

## 9. The migration

**The honest answer: mostly incremental, with one core that is not.**

### The mechanism: ratchet the validity radius

This is the part worth understanding, because it is what keeps a father and a
six-year-old able to play while the ground moves underneath them.

The outdoor park begins as **one flat chart with `validFor: Infinity`**. That is
*exactly today's behaviour* — the implicit global flat chart, now merely written
down. Nothing changes, nothing breaks, the game plays identically. The types are
in place and the machinery is inert.

Then the number comes down:

```
Infinity → 160 → 120 → 80 → 40 → 0
```

At each step, every consumer that reads beyond the bound goes **red**, and must
either move onto its own local chart or onto the curved API. When it reaches 0
there is no flat park chart at all, and the sphere is the domain. The final step
flips `kind` to `'curved'` and deletes the flat park chart entirely.

This is monotone, measurable, CI-enforceable and revertible one notch at a time
— the same shape as `check:coplanar`'s ratchet, which this repo already trusts.
It also means **the work can stop at any notch and the game still works**, which
is the property that matters if Jim wants to spend six weeks instead of nine.

### What is not incremental

**`CollisionWorld` and `NavGrid` swap in one go.** A 2D lattice has no
half-spherical form; you cannot convert a quarter of an A* graph. These are
built alongside the old ones, run in parallel with a differ that asserts they
agree within the old one's own error, and then switched. The switch is a single
commit and it is the highest-risk moment in the whole programme.

### What the intermediate states look like

- **Phases A-B:** invisible. The types land, the Anchor lands, ~90 inventory
  sites are fixed as a class, and the park visibly *improves* — the tap ring
  lies on the grass, the hop rainbow lies flat, the fill light comes back above
  the horizon. This is the phase with something to show Jim.
- **Phase C (the collision/nav switch):** a measured window, days not weeks,
  where tap-to-move and collision behave differently and need real browser QA
  on several seeds. This is where the game can genuinely break for a player.
- **Phase D (generators):** some seeds will produce worse parks before they
  produce better ones, because a generator newly aware of the sphere will refuse
  placements it used to accept. `test:procgen`'s five seeds are the tripwire and
  the solve-rate is the metric, per Decision 10.
- **Phase E (checks):** the checks go red *before* they go green, deliberately.
  A check rebuilt onto the sphere finds the bugs the flat check was blind to, and
  those bugs are real. Budget for fixing them, not just for rewriting the checks.

---

## 10. What it costs

A number, not an adjective, and built from the measured sizes: **169,758 lines
in `src/`** (391 files), **52,563 in `scripts/`**, **16,708 in `test/`**.

| # | Piece | Fate | Size | Agent-weeks | Parallel? |
|---|---|---|---|---|---|
| A | `Geo`/`Frame`/`Chart`/`Field`/`Portal` core + the geodesic primitives | **new**, ~1,500 lines | — | 2 | no — one coherent design |
| A2 | Spherical spatial index (S2-shaped, own implementation) | **new** | — | 2 | with A |
| B | `Anchor` + scene-graph migration | adapt | 51 `scene.add`, 79 flat-disc sites, some of 681 `position.set` | 4 | yes, ~4 agents |
| C1 | `CollisionWorld` | **rewrite** | 1,233 lines; 78 call sites in 23 files; no spatial index today | 4 | with C2 |
| C2 | `NavGrid` | **rewrite** | 1,490 lines; 2.5D `(cell, level)` lattice, 5 live instances | 4 | with C1 |
| C3 | Player + NPC locomotion, gravity, fall detection | **rewrite** | ~1,500 lines | 2 | yes |
| D | Generators and solvers onto the curved chart — `paths` 5,522, `coaster/route` 1,543, `slide/solve` 1,500, `railRace/track` 1,619, `rail/generate` 1,385, `train/*` ~3,500, `Scenery` 2,399, `building/layout` 1,421 | **rewrite** planning layer, keep mesh building | ~19,000 lines | 12 | yes, ~4 agents |
| D2 | `GroundClaims` shapes → geodesic regions; the `clear()` callback → `Geo` | **rewrite**, reaches 4 solvers | 451 lines + placers | 2 | after A |
| E | Portals, interiors, the seam, portal-instanced geometry | **new + rewrite** | — | 2 | yes |
| F | Rides, cameras, the ride-camera mounts | adapt heavily | ~4,000 lines | 3 | yes |
| G | Checks and invariants — ~50 spatial files, `invariants.ts` alone 9,700 lines | **rewrite** | ~25,000 lines | 10 | yes, ~4 agents |
| H | Art, effects, world UI, lighting | adapt | ~2,000 lines | 2 | yes |
| | | | | **~47** | |

**Wall-clock, with the dependency chain and a 5-8 agent fleet:**

| Phase | Work | Weeks |
|---|---|---|
| A | Core types + index (serial, cannot be parallelised away) | 1.5 |
| B | Anchor migration + the visible wins | 1.0 |
| C | Collision, nav, locomotion (parallel; the risky switch) | 2.0 |
| D | Generators + claims + portals + rides (parallel) | 3.0 |
| E | Checks, and fixing what they newly find | 2.0 |
| — | Integration, QA across seeds, tail | 1.0 |
| | **Total** | **~10.5** |

**Call it 9-11 weeks.** This is up from the 8 ± 2 I gave the Overseer in my first
hour, and the reason is worth stating rather than smoothing over: the survey
established that **no flat patch on a 220 m planet is big enough to hold a ride
or a route** (§1), so the shared rail solver cannot be reinterpreted into a
tangent plane and has to become genuinely geodesic. That is about two extra
agent-weeks and half a wall-clock week. Nine if Phase D goes well and the checks
find less than expected; eleven if they do not. The **hard floor is about 5 weeks**
and it is set by Phases A and C, which cannot be parallelised away by any amount
of fleet — and buying below that floor means shipping the collision/nav switch
without the parallel-differ safety net, which is not a trade worth making on a
game a child plays.

**What is rewritten rather than adapted:** `CollisionWorld`, `NavGrid`, player
and NPC locomotion, every generator's *planning* layer, and about 25,000 lines
of checks. **What is adapted:** the Anchor migration, rides and cameras, art and
effects. **What is untouched:** all of `src/art/models/**` mesh authoring, every
minigame (each owns a disjoint flat space and is correct as a flat chart by
construction), the UI, saves, and the asset pipeline.

**For comparison, and this is the number that makes the case.** The
instance-by-instance approach has spent one day of five engineers. Measured:
`src/world/Collision.ts`, `src/world/NavGrid.ts`, `src/world/spaces.ts` and
`src/world/building/floors.ts` are **byte-identical between `origin/main` and
`feat/sphere-combined`.** The entire sphere effort to date lives in two files —
`terrain.ts` and the new `up.ts`, 477 lines between them — and has touched
**neither the collider store, nor the router, nor the space table.**

That is not a criticism of the engineers; those three subsystems cannot be fixed
incrementally, which is exactly why nobody did. But it means the day of work
bought real defect fixes and moved the *representation* not at all, and the
~95 open sites are the count found so far by people looking, not the true count.
This design retires most of them as classes, and stops the next ninety-five
being written.

---

## 11. What survives of today's helpers

Per the brief: some of `terrain.ts` and `up.ts` are a sketch of the layer Jim is
asking for. Explicitly, which:

| helper | fate |
|---|---|
| `altitudeAt(x, y, z)` | **Survives in spirit, as `altitude(geo)`.** Its docblock is the best statement of the problem in the repo and should be carried across. Both terms already being radii from one centre is exactly right. |
| `yAtAltitude` / `liftFromGround` | **Survive as chart operations.** The distinction its docblock draws — one keeps the column, one moves along the local up — is a real and important one, and becomes `chart.liftLocal` vs `chart.liftGeodesic`. The doc comment explaining *why* both exist is worth more than the code. |
| `upAt(x, y, z)` | **Becomes `chart.upAt(local)`.** Same mathematics; the change is that it can no longer be called without saying which chart, which is the whole point. |
| `capHeight` / `groundWaves` split | **Survives and is vindicated.** Separating the sphere from the waves is exactly the `Field` idea one instance early: the cap is the chart, the waves are a `Field` over it. |
| `planetRadiusAt` / `groundRadiusAt` | Survive as `radius(geo)` / `groundRadius(direction)`. |
| `terrainNormal` | **Survives, and its docblock's warning gets teeth.** It is the true normal including waves; `upAt` is the sphere's radial. They are different vectors and were the same on a flat park, "which is why a good deal of code used them interchangeably". Under `Frame` they are different types of thing and cannot be confused. |
| `placeOnSphere` / `standOnSphere` / `faceOnGround` / `tiltToSphere` | **Retired, subsumed by `Anchor`.** They are the manual version of what the Anchor does automatically, applied at the ~129 sites that remembered to call them. |
| `INDOOR_UP` | **Retired.** Replaced by a flat chart's own `upAt` — same vector, but now attached to a declared chart with a declared extent rather than being a free-floating global. |
| `spaceAt` / `castleFloorAt` | **Deleted.** Positional inference is the mechanism this design replaces with carried identity (§3.3). Only 21 call sites. |
| `TERRAIN_RADIUS = 83.5` | Stale today — its comment says "where the ground stops" while the park reaches 157 m. Dies with the flat park chart. |

---

## 12. Defects found while surveying, which do not wait for this design

Three things turned up during the survey that are live now. Per CLAUDE.md, they
are reported rather than filed away, and none of them should wait eight weeks.

**1. `NavGrid`'s `MAX_EXPANSIONS` is now below its own cell count, on
`feat/sphere-combined`.** The park grew by `PARK_SURFACE_SCALE = √(1200/220) =
2.335`, so `GARDEN_PLAY_RADIUS` went 58 m → 135.4 m. The lattice is square in
the boundary's extent, so it grew by the **square** of that: roughly 152k–185k
cells before, **660k–865k cells now**. `MAX_EXPANSIONS = 160_000` — whose header
justifies the number as "the count is the same [as cells]" — is now a factor of
four to five *below* the cell count. A* can exhaust its budget before reaching a
goal and silently return a route to "the nearest standable place" instead, which
is indistinguishable from a legitimate unreachable-goal answer. This is
tap-to-move quietly degrading in the outer park, on top of the `MAX_STEP`
diagonal failure already inventoried, and from an unrelated cause.

**2. A stale comment asserting the two radii agree.** `PARK_REFERENCE_SPHERE_RADIUS`'s
docblock says it is *"held equal to `GROUND_SPHERE_RADIUS`, which makes the
scale exactly 1"*. It is 1200 against 220, and the scale is 2.335. This is
this repo's single commonest bug — a comment promising two numbers agree,
standing in for a mechanism — and CLAUDE.md's "correct it where you find it"
applies.

**3. `BOUNDARY_LEASH_REACH = 100` is a hand-tuned number whose margin has
narrowed.** It works because the inter-space gaps are 60–120 m and the garden
was ~110 m across. The garden is now ~271 m across. Nobody has re-derived it.

And one structural observation that belongs with the cost, not with the defects:
**`Collision.ts` has no spatial index at all** — two flat arrays, linear-scanned
twice per resolve, no quadtree, no grid, no bucketing. It has been fine because
the park was small. At 2.33× the radius and 5.45× the lattice it is on a
trajectory, and §6's spatial index is therefore a win that pays for itself
independently of the sphere.

---

## 13. Open questions for Jim

Three, and only the first is blocking.

1. **Does a child ever walk right round the planet?** She cannot today — the
   `(x, z)` chart is singular at 220 m. `Geo` supports it for free, and this
   design assumes she does *not*, but the assumption should be stated rather
   than inherited. If the answer is yes, §6's spatial index gets more important
   and the park boundary becomes a different kind of thing.

2. **How much may a transparent portal cost?** §5 says most portals are opaque
   and transparency costs a render pass. If Jim wants to *see into* the castle
   from the park, or see the park from the roof garden, that is a different and
   more expensive design, and the edge artefact described in §5 becomes visible.
   Not blocking — the default is opaque, which matches today.

3. **The sun on a planet.** Flagged in `RADIAL-INVENTORY.md` §3.2 and explicitly
   marked as Jim's call, not an engineer's: on a real sphere, `N·L` at 157 m goes
   negative whenever the sun is below 45° on that side, so for hours either side
   of noon the outer park is in genuine geometric shadow while the game's
   `nightFactorValue` says broad daylight. A terminator is what a planet does.
   This design makes it *possible* to have one and does not decide whether the
   game should. Given the audience, "the park is always sunny" is a perfectly
   good answer — but it should be chosen.

---

## Appendix: how the measurements in this document were taken

Every number above was measured rather than quoted, per CLAUDE.md. The sag and
lean figures come from `R = GROUND_SPHERE_RADIUS = 220` read out of
`src/core/constants.ts`, with sag as the exact `R − √(R² − (L/2)²)` rather than
the `L²/8R` approximation everyone writes; chord lengths come from
`INTERIOR_HALF_X/Z`, `INTERIOR_PLAZA_RADIUS` and `GARDEN_PLAY_RADIUS` in the same
file. The lattice-distortion table is `0.5 / cos(asin(d/R))` against `NavGrid`'s
`MAX_STEP = 0.62`. Line and call-site counts are `find`/`grep` over `src/`,
`scripts/` and `test/` on `origin/main` at `49310060`, cross-checked against
`feat/sphere-combined` where the sphere helpers live. The library survey is
§6 and names what was examined. Where this document relies on a fact it did not
measure — the ~95 open sites, the ride-geometry defects — it is citing
`RADIAL-INVENTORY.md` and `ALTITUDE-INVENTORY.md` on `seek/radial-inventory`,
which are the requirements document for this work as much as this file is.
