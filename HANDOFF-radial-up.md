# HANDOFF — a smaller sphere, and "up" means away from its centre

**Model: Opus (`claude-opus-5[1m]`), chosen by the Overseer as the Engineer
default.** A replacement must run the same model.

Branch `feat/sphere-combined`, worktree `.claude/worktrees/sphere-combined`.
Dev server **5391** (already running when I arrived; PID in
`/tmp/claude-501/vite5391.pid`). Jim has suspended checks, gates, CI and PRs
for this work.

## Jim's ruling, and what it turned out to mean

> *"I want the sphere now to be made smaller, so that the curve is noticeable
> but not overwhelming, then I want 'up' everywhere to mean away from the centre
> of the sphere. Indoors can still use plain 'up'."*
>
> *"that's fine, apply the sine waves on the surface of the sphere."*
>
> *"I don't care what the gradient is now, I asked for a new definition of 'up'
> and I want you to do it, don't get me more info, just get an agent to do it."*

## The links

**Jim's links come from the built preview on 5412, never the dev server.** See
the section on that below — it is a standing rule now, not a preference.

- `http://localhost:5412/sky-cruiser` — **the planet.** Riding over the real
  park, the world falls away to the side. This is the link he judges the radius
  from.
- `http://localhost:5412/arrive` — the cat bus pulls up with both wheels flat on
  the road, the ground curving away either side. Add `?at=stepping-down` to skip
  the twenty-second loading ride and land at the stop.
- `http://localhost:5412/spawn?pos=0,-95&facing=180` — standing at the boundary,
  where the lean is strongest.

For your **own** iteration, on the dev server (5391):

- `/view?camPos=0,22,0&camDir=0,-0.12,-1&timeOfDay=12:00` — a frozen free camera
  22 m up at the park's centre. It is the right instrument for comparing two
  radii side by side because nothing in it moves, and it is the wrong thing to
  send Jim.

## The radius, judged by eye

Four frames from one fixed camera on the canonical seed, in
`…/scratchpad/radius-*.jpeg`:

| R | what it reads as |
|---|---|
| 1200 (was) | dead flat. No curve at all. |
| 600 | the treeline arcs gently, the grass falls at both frame edges |
| 350 | the world clearly domes; you see over the treeline all round |
| 220 | a knoll — the park itself falls away and the disc reads as a lump |

**Taken 400 first; now at 300**, which Jim asked to see next. He has not answered
yet. **Do not change the radius without him** — it is the one thing he is
actively judging.

## The mechanism — three functions and one file

`src/world/terrain.ts`:

- `upAt(x, y, z)` — the outdoor answer. The cap is tangent at the origin, so
  the sphere's centre is `(0, -R, 0)` and up is the direction from there.
  **Pass the real `y`**: a child forty metres up the ferris wheel is forty
  metres further from the centre than her feet.
- `INDOOR_UP` — plain `+Y`, named so the choice is legible at a call site.
- `tiltToSphere(x, y, z)` — the rotation taking `+Y` to that up.
- `placeOnSphere(flat, yaw, position, quaternion)` — **the one map from the
  flat frame the whole park was authored in onto the sphere.** Same foot on the
  same `(x, z)`, the height re-measured along the local up, the yaw still a turn
  about that up.
- `standOnSphere(object)` — the one-line form, for an object already positioned.

`src/world/up.ts` — the **only** place that branches indoor/outdoor:
`upFor`, `isOutdoors`, `standOnGround`, `faceOnGround`.

### Why the branch has to exist

Interiors are not a mode; they are real coordinates a long way off. The castle's
floors and the hotel's rooms sit **600 m** from the park's origin, and `upAt` at
600 m on a 400 m sphere leans by **56°**. Applied blind, the first thing a child
sees walking into the hotel is the lobby lying on its side. `spaceAt(x, z)` is
the test, and it is the same one collision and the walk surfaces already use.

### The waves ride on the surface

`terrainHeight` now returns `base * (rise / R) - fall` rather than
`base - fall`: the wave is a displacement of `base` metres **along the local
normal**, whose vertical component is `cos(tilt) = rise / R`. At the centre that
is 1 and nothing changes.

**What this means for `BUS_MAX_GRADE`, and it is not what the open ticket
says.** The cap's slope measured against *radial* up is **zero by
construction** — the surface normal *is* up. So once up is radial, the only
slope a child or the bus feels is the waves. `BUS_MAX_GRADE = 0.1` has stopped
being a statement about the cap and become one about the wave field
(`groundWaves`, which is now its own export for exactly this). The
12.78 %-worst measurement in `HANDOFF-ground-gradient.md` is a measurement of
slope-against-`+Y`, which is no longer the quantity anybody feels.
**`theGroundIsTheSphereItClaimsToBe` at `test/procgen/invariants.ts:9549` still
computes `d / GROUND_SPHERE_RADIUS` and compares it to `BUS_MAX_GRADE` — it
never measures terrain and cannot fail. That is still open, and it should be
rewritten to sample `groundWaves` in the steepest direction.**

## THE BUG THAT WILL CATCH THE NEXT PERSON

**A per-frame tilt must not be a pre-multiply.**

`object.rotation.y = yaw` does not set the rotation to a yaw. It rebuilds the
quaternion from **all three** Euler components, and `x` and `z` are whatever
they were last frame. Tilt by a pre-multiply and three.js decomposes the tilt
straight back into `rotation.x` and `rotation.z`; the next frame's
`rotation.y =` picks them up as if they were meant, and leans again on top.

Measured on the player at the boundary: `rotation.x = -0.59` on the first frame,
`(1.11, 3.14)` a second later. **She was slowly tumbling — and the screenshot
that "proved" it working had caught her the right way up.** This is the third
attempt at a world change on this branch and the previous two failed by
reasoning about things nobody had looked at; this one nearly did too, and the
only reason it did not is that the frame was followed with a two-second
measurement.

- **`faceOnGround(object, yaw, pitch?)`** — takes the yaw, never reads what is
  there. Use it for anything inside an update/tick.
- **`standOnSphere` / `standOnGround`** — build time only, once per object.

The proof it is right now, measured on the built park at `(6.46, -6.95, -72.4)`:
her local `+Y` in world space is `(0.004, 0.974, -0.225)`, the radial up there
is `(0.004, 0.974, -0.225)` — **0.000° apart**, and 13.03° off world `+Y`.

## Done, and looked at

- **terrain** — the vocabulary above; waves on the surface.
- **foliage** — every trunk, canopy, cone and bush on the lawn *and* in the
  treeline, through the one `makeInstanced` in `treeModel.ts`. Measured from
  the ground under each part, not about each part's centre: rotating a canopy
  about itself leaves the ball behind while the trunk leans.
- **player** — all three orientation writes, via `faceOnGround`.
- **park camera** (`IsoCamera.applyTransform`) — the rig offset is rotated into
  the local frame *and* `camera.up` is set, taken at the focus. Rotating the
  offset is the load-bearing half; `up` alone would roll the picture while
  leaving the pitch disagreeing with the ground. Verified live:
  `camera.up = (-0.004, 0.992, 0.129)`.
- **lamp posts, boundary wall, the fences and low stone walls in Scenery**
- **railway** — sleepers, lineside fence, stations
- **NPCs, pets, the parade, the rail race's exit crowd.** `NpcCharacter` gained
  a public `facingAngle`: `NpcSystem` was reading the yaw back off
  `rig.root.rotation.y`, which now carries the tilt too, so the pets would have
  trailed off at an angle.
- **flowers, fairy lights, tree lights, fireflies, anchor plots, the fountain,
  the foliage fade stand-in** (one agent) — it found two real bugs doing it: the
  plot pegs were double-counting the tilt, and the fountain's `waterLevel` was
  one world Y for a basin whose two sides now sit 0.35 m apart.
- **keychain cart, face-paint booth, every mini-game booth, the welcome sign,
  the bus shelter, the gate arch** (another agent).
- **tree sightline spheres** — a leaning tree's canopy is over a metre sideways
  of its flat centre at the park's edge, more than `SIGHTLINE_MARGIN`.

`pnpm run build` exit 0, `pnpm exec tsc --noEmit` exit 0. No gates run — Jim
suspended them for this work.

## Links to Jim come from a built preview, never the dev server

Jim, 13 September 2026: *"the live reload keeps stopping my game - only give me
stable urls with vite preview and a build."* Every link he had been given was a
dev server, so each push reloaded the page under him mid-play.

- **Preview on 5412** — `pnpm run build`, then
  `pnpm exec vite preview --port 5412 --strictPort`. PID in
  `/tmp/preview5412.pid`. **Leave it up; do not restart it while he is looking.**
  Build again and tell the Overseer when there is something new worth showing.
- **Dev server on 5391** is for your own iteration only.
- The rule is in `CLAUDE.md` on `main` as of `49310060`.

## The link that shows the planet is a ride, not a camera

`/sky-cruiser`. It flies over the real park and the world visibly falls away.

I got this wrong first time and it cost a round trip: I checked `/spawn` at play
zoom, found no horizon in frame — which is true, the camera is pitched at the
grass — and concluded the curve was not judgeable in-game. Jim rejected that,
and he was right: **elevation was what was missing, not the projection.**
`/ferris` is no good either, because the wheel is its own space with its own sky
and no park in it. The cruiser's circuit passes *through* the castle for a few
seconds where there is nothing to see; the curve reads on the open stretches.

## Done since the first pass

- **The castle and the hotel were floating**, and it was three height faults,
  not a `spaceAt` fault — both shells were already leaning correctly (0.5° and
  0.0° off radial) before I touched them. See the commit "The castle and the
  hotel stand on the ground again" for the full account. Now: castle courtyard
  floor +0.22 m over the grass, hotel crystals −0.26 to −0.31 m against the
  0.30 m buried margin `hotelAssets.ts` documents.
- **`standInPlot`** (`world/AnchorPlots.ts`) — stands a building's root on the
  ground at a world coordinate inside a plot that is already leaning, by solving
  the world transform and carrying it back through the plot's inverse. Use it
  rather than subtracting world positions, which arrive rotated.
- **`groundInPlot`** (same file) — "how high is the ground here, in this plot's
  own leaning frame". Its control: **it returns zero everywhere on a bare cap.**
  Fixed the water fight's lawn and the ferris wheel's feet and boarding deck,
  which were each differencing two world heights and so driving the downhill
  side in by twice the cap's drop.
- **The rail race rides the sphere.** `route.base` was one absolute world `y`;
  the ring follows a boundary running 58–110 m out, so it varied its clearance
  by 11 m round its own circumference. Now `capHeight + route.clearance`, with
  `baseAt(distance)` replacing `base`. Trestles measure **0.16° off radial**,
  duck-bar posts **0.30°**, and the rail's height above the sphere varies by
  6.12 m, which is the ride's own designed undulation and nothing else.
- **The cat bus stands on the road's own up**, solved inside `placeBus` which
  runs every frame, so the tilt follows the run. All four wheels within 1.9 cm
  of the ground (worst dig-in 1.9 cm, spread 0.185 m — the waves under a 5 m
  wheelbase). Before: the ground under the four contact points differs by
  **2.43 m** and a yawed-only chassis puts all four wheel bottoms at one height.

## Two traps this work has already sprung twice

**1. A per-frame tilt must not be a pre-multiply.** `rotation.y = yaw` rebuilds
the quaternion from all three euler components, so a tilt decomposed into
`rotation.x`/`z` is inherited next frame and compounds. The player was
*tumbling* and the screenshot that "proved" it working had caught her the right
way up. `faceOnGround(object, yaw, pitch?)` is the per-frame form;
`standOnSphere`/`standOnGround` are build-time only.

**2. Build a multi-part shape in ONE frame, then lean the finished thing.** The
trestles' fork nodes and trunk top are each derived from their neighbours.
Solved from rails that had already been leant, the top inherited the rails'
outward displacement while the foot stayed on its own ground, and the trunks
came out at **28°** from `+Y` against a radial of 14 — leaning twice as far as
the ground. `route.flatPointAt` exists for exactly this.

**And the third, which is about instruments rather than code:** two of my own
measurements were wrong before they were right. A sweep that grepped mesh names
for `/rail|trunk|post/` silently mixed **tree** trunks in with the ride's; and I
reported the arrival camera as broken from a probe taken at eight seconds when
`?at=stepping-down` enters at elapsed 6.6 s and the shot ends at 9.1. Run a
control on the instrument, and check *when* you sampled as well as what.

## NOT done, and why — read this before picking it up

### Collision, navigation and gravity stay in the flat frame

`world/Collision.ts` has **no Y in its geometry at all**: circles and walls in
XZ, plus `topHeight`/`baseHeight` scalars. `NavGrid` is a 2D lattice. Gravity is
a scalar on `position.y`. Making those radial is a rewrite of the physics, and
it is **invisible** — the ground under her feet is still the ground under her
feet, and a 1.28 m hop on a 13° tilt drifts by centimetres. So this work tilts
the **render frame** and leaves collision flat. If Jim ever wants a child to
walk right round the ball, that is a different and much larger piece of work.

### The rides: what is left, and the shape of it

**Done:** the rail race (ring, trestles, duck bars) and the cat bus.

**Left standing on world `+Y`:** the **coaster and sky-cruiser pylons** and the
**ginormous slide's legs**. Jim has ruled these in — *"ride supports need to be
using local gravity, as does their slope and any other measure"* — so they are
the job, not a ticket.

**The shape of the fix, worked out but not yet applied.** Both rides are a
`CatmullRomCurve3` through control points solved in the flat frame. Do **not**
map the control points: the physics, the clearance solves and the invariants all
read `pointAt`, and because `placeOnSphere` is locally a rotation, a height
above the ground and a gradient are both **preserved** by it — so the flat frame
is already the right frame for every one of those. Instead add a `drawPointAt`
(the flat point, leant) and use it for the **drawn** geometry only: the track
ribbon and the top of each pylon, with the pylon's **foot** left at the flat
`(x, z)`. That is the same split `flatPointAt`/`pointAt` gives the rail race,
and it makes each pylon lean radially for free while nothing that solves or
checks the ride moves at all. Lower risk than what the rail race needed, where
the *base* was genuinely wrong and had to change.

### The arrival camera is fine — do not go looking for a bug

`arrivalCameraEngaged` is **true** from the first frame of
`/arrive?at=stepping-down` through to elapsed 9.09 s, then releases normally.
I reported it broken; I was wrong, and the reason is worth keeping: `?at=`
enters at elapsed **6.61 s** and the shot has ~2.4 s left, so any probe or
screenshot taken later than that sees the ordinary camera doing its job. To
photograph the door beat, freeze it: poll until `game.arrivalCameraEngaged`,
then set `game.timeScale = 0`. The shot itself is intact after the bus was
tilted — outside the bus, facing its doors, children coming down the step.

### Everything the radius change moves

Changing `GROUND_SPHERE_RADIUS` 1200 → 400 moves **every park**. Digests,
baselines, per-seed numbers and the coplanar/swept-bus ratchets will all shift.
That is expected, not damage. Jim's standing ruling covers the seeds:
*"if some seeds fail now, kick the can down the road until we rebase the new
procgen, just use fewer seeds for now."* Retire a failing seed in its own
commit with the reason and his words quoted — but only after checking it is not
the *same* failure across several seeds, which would be a bug in this work
rather than a bad seed.
