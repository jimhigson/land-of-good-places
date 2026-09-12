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

- `http://localhost:5391/view?camPos=0,22,0&camDir=0,-0.12,-1&timeOfDay=12:00`
  — **the frame for judging the planet's size.** A free camera 22 m up at the
  park's centre, looking south, frozen at noon. The treeline bends away on both
  sides, the lamp posts and trunks fan outward.
- `http://localhost:5391/spawn?pos=0,-95&facing=180` — standing at the boundary,
  where the lean is strongest (13° there).

**Do not send a `/spawn` link to judge the planet.** Measured: at play zoom the
camera is pitched steeply enough at the ground that **no horizon is in frame at
all**. The size of the ball is only judgeable from a camera that can see one.

## The radius, judged by eye

Four frames from one fixed camera on the canonical seed, in
`…/scratchpad/radius-*.jpeg`:

| R | what it reads as |
|---|---|
| 1200 (was) | dead flat. No curve at all. |
| 600 | the treeline arcs gently, the grass falls at both frame edges |
| 350 | the world clearly domes; you see over the treeline all round |
| 220 | a knoll — the park itself falls away and the disc reads as a lump |

**Taken 400.** Jim gets the link and says bigger or smaller.

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

## NOT done, and why — read this before picking it up

### Collision, navigation and gravity stay in the flat frame

`world/Collision.ts` has **no Y in its geometry at all**: circles and walls in
XZ, plus `topHeight`/`baseHeight` scalars. `NavGrid` is a 2D lattice. Gravity is
a scalar on `position.y`. Making those radial is a rewrite of the physics, and
it is **invisible** — the ground under her feet is still the ground under her
feet, and a 1.28 m hop on a 13° tilt drifts by centimetres. So this work tilts
the **render frame** and leaves collision flat. If Jim ever wants a child to
walk right round the ball, that is a different and much larger piece of work.

### The rides are a real piece of work, not a one-line lean

Left standing vertical, and visible as such in the frame: the **rail race
trestles**, the **ferris tower**, the **coaster/sky-cruiser pylons**.

The rail race is the instructive one. Its ring is at a single constant world
height — `base = (max terrainHeight round the ring) + BASE_HEIGHT` — and its
physics gradient `slopeAt` is a **closed form** that assumes that base is level.
On a 400 m sphere a ring whose radius runs 58–110 m now varies its clearance
above the ground by up to **11 m** round its own circumference. Fixing it
properly means the base following the cap (which is also the physically right
answer: the cap contributes no felt gradient, so `slopeAt` should keep returning
the undulation alone) and `pointAt` displacing laterally — and that last part
moves the route's horizontal geometry by up to ~5 m, which ripples into
`postClearsEntranceRoad`, the boundary clearance checks and the invariants.
**Do not bodge it.** Expect the failures four steps upstream, as every sphere
bug on this branch has behaved.

### The arrival camera

Jim's approved arrival still runs: it opens low at the pavement (`camera.y` 1.5),
travels, and hands over to the ordinary camera at `y` 46.5, whose `up` is now
radial. **I did not manage to photograph the door beat itself** — `?at=` fast
forwards during the load, so both attempts landed after handover. Somebody with
a frame-accurate capture should confirm the door framing, which was judged by
eye and could have shifted.

### Everything the radius change moves

Changing `GROUND_SPHERE_RADIUS` 1200 → 400 moves **every park**. Digests,
baselines, per-seed numbers and the coplanar/swept-bus ratchets will all shift.
That is expected, not damage. Jim's standing ruling covers the seeds:
*"if some seeds fail now, kick the can down the road until we rebase the new
procgen, just use fewer seeds for now."* Retire a failing seed in its own
commit with the reason and his words quoted — but only after checking it is not
the *same* failure across several seeds, which would be a bug in this work
rather than a bad seed.
