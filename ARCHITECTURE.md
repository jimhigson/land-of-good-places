# Architecture

How **Land of Good Places** is put together, and where to add things.

This is a browser game built with [three.js](https://threejs.org) and Vite, in
strict TypeScript with no runtime dependencies beyond three. The whole park is
generated in code — there are no model or image files to load, which is why it
boots instantly.

---

## The shape of it

```
src/
  main.ts            entry point: finds the canvas, builds Game, hides the splash
  Game.ts            owns the frame; wires every system together

  core/              engine-level things that know nothing about the park
    Engine.ts        renderer + scene + resize handling
    Loop.ts          requestAnimationFrame loop, fixed-ish delta, FPS counter
    IsoCamera.ts     orthographic isometric rig: follow, 90° snap-rotate, zoom
    constants.ts     every tuning number in the game
    palette.ts       every colour in the game
    mathUtils.ts     lerp/damp/smoothstep/angles + the seeded Rng
    textures.ts      procedural canvas textures (grass, wood, stone, signs)
    types.ts         FrameContext and the GameSystem interface
    input/           keyboard + gamepad, unified behind named actions

  state/             plain observable store: park name, player, clock, money
  world/             the park itself (see below)
  entities/          things that move — currently just the Player
  ui/                DOM overlay (HUD) and the floating name label
```

### The frame

`Game.tick()` runs the same order every frame, and the order is deliberate:

1. **`input.update()`** — snapshot the devices once. Every system then sees
   identical input, and edge queries like `justPressed` behave.
2. **`player.update()`** — the player moves first, because the camera and the
   sun's shadow frustum both follow wherever they end up.
3. **`camera.update()`** — follows the player, handles rotate and zoom.
4. **`world.update()`** — clock, sky, water ripples, fairy lights, signs.
5. **extra systems** registered with `game.addSystem()`.
6. **render** — the sky backdrop pass, then the world on top.

### GameSystem

Anything with per-frame behaviour implements `GameSystem` (`core/types.ts`):

```ts
interface GameSystem {
  readonly name: string;
  update(context: FrameContext): void;
  dispose?(): void;
}
```

`FrameContext` is allocated once and rewritten each frame — systems receive it
fully `readonly`, so nobody can stash it and mutate it later. It carries `dt`,
`elapsed`, `frame`, the `input` snapshot, `playerPosition` and `cameraForward`.

To add a system: build it, expose a `group` if it has geometry, add the group to
the scene, and call `game.addSystem(it)`.

---

## The world

`world/World.ts` owns the build order, and the order matters: every builder
registers its solid parts with a shared `CollisionWorld`, so that is constructed
first and handed to each of them.

| File | What it is |
| --- | --- |
| `terrain.ts` | `terrainHeight(x, z)` — the single source of truth for ground height. Everything that sits on the ground calls it. |
| `paths.ts` | Catmull–Rom path ribbons draped over the terrain, plus `isOnPath()` used by scatter placement. |
| `Garden.ts` | The terrain disc, the paths, the pink boundary wall. |
| `Scenery.ts` | Trees, bushes, flowers, wooden hiding walls, stone walls, and the treeline. |
| `Fountain.ts` | The wishing fountain. Animated water, no shader. |
| `FairyLights.ts` | Strings of bulbs on poles around the plaza. |
| `AnchorPlots.ts` | The five reserved building plots and their "coming soon" signs. |
| `building/` | The big building: five decks, six ways between them, the ginormous slide and the ball pit (see below). |
| `Sky.ts` | Full-screen sky backdrop pass: gradient, sun, moon, stars. |
| `DayNight.ts` | The clock. Drives lights, fog, and every Sky uniform. |
| `Collision.ts` | Circles and thick line segments; push-out resolution. |

### Three decisions worth knowing about

**The camera is orthographic, and that changes everything.** With parallel
projection there is no perspective convergence and no horizon. Two consequences
are baked into the design:

- *The sky cannot be a dome.* A dome would render as one flat colour and the sun
  would never appear on screen. `Sky.ts` is therefore a screen-space quad drawn
  before the world, with the sun and moon positioned by mapping their compass
  bearing relative to the camera onto the screen's x axis. It is a cheat, and it
  tracks convincingly when the view rotates.
- *Distance moves things up the screen, not toward a horizon.* A point `d` metres
  further away at height `h` lands at `d·sin(pitch) + h·cos(pitch)` up the frame.
  An early build had a ring of distant hills; all that was ever visible was their
  sunken flanks. If you want a horizon, paint it into the Sky shader.

**The park is a diorama on a hilltop.** The camera shows only ~36 metres of
ground depth, so an endless ground plane fills the frame forever and the whole
day/night cycle goes unseen. Instead the terrain is a disc ending at
`TERRAIN_RADIUS`, and `terrainHeight` drops the ground away sharply between
`RIM_START` and `RIM_END` — steeper than the camera pitch, so the slope hides
itself and the horizon appears just above the boundary wall. The cut edge is
masked by the treeline in `Scenery.ts`.

**Fog is measured from the camera, not the player.** The orthographic rig parks
its camera `CAMERA_DISTANCE` back, so `FOG_NEAR`/`FOG_FAR` are expressed as
offsets from that. Setting them as if for a perspective camera puts the entire
park inside the fog and turns the game milky.

### Colours and numbers

Every tunable number lives in `core/constants.ts`; every colour lives in
`core/palette.ts`. Neither imports anything, so any module can depend on them
without creating a cycle. If you find yourself typing a magic number into a
system, it probably belongs in `constants.ts` instead.

The day/night look is a small keyframe table (`SKY_KEYS` in `DayNight.ts`)
interpolated around the clock, rather than a physical sky model — art-directing
"sunset should be *this* orange" is far easier than deriving it. Note that the
sun is only above the horizon between `t = 0.25` and `t = 0.75`, so keys must sit
inside that window or their colours will only ever appear after dark.

### Rendering notes

- Tone mapping is `NeutralToneMapping`, not ACES. ACES desaturates bright colours
  toward white, which is the wrong look for a park made of sweets.
- Shadows are `VSMShadowMap` for genuinely soft edges (`PCFSoftShadowMap` is
  deprecated in current three).
- **Hand-written `ShaderMaterial`s must include `<tonemapping_fragment>` and
  `<colorspace_fragment>`.** Uniform `Color`s are linear and the framebuffer is
  sRGB; skip these and your shader renders dark and the wrong hue. This cost an
  hour on `Sky.ts`.
- Anything that appears many times is an `InstancedMesh`. The park's ~1,200
  trees, bushes and flowers cost a handful of draw calls.
- **Shadow casting is opt-out, not free.** `renderer.info.render.calls` counts
  the shadow pass too, so every caster is drawn twice. Interior fittings, applied
  decoration (windows, balustrades, escalator steps, signs) and anything sitting
  inside a hole are `castShadow = false`; the shell, the roof and the ginormous
  slide still cast, which is all the shadow the eye is looking for.
- Current budget with the building in: about **270 draw calls** indoors,
  **355–430** at default zoom, and **~540 / 400k triangles** in the worst case
  (the middle of the park at maximum zoom-out, with the whole park on screen).
  That runs at **~115 fps at device pixel ratio 2** on an M-series laptop.

### The big building

`world/building/` fills the `building` and `ballPit` anchors. Three ideas carry
the whole thing, and everything else is geometry.

**The floor plan is data, in `building/layout.ts`.** Deck holes, stair and
escalator ramps, doorways, shop-unit positions and the ball pit all live in one
table, in building-local metres with `y = 0` at the ground-floor deck. Geometry
and gameplay both read it, so a wall and the thing you walk on can never drift
apart. The one rule that must not be broken: **every hole in a deck is fully
spanned by a ramp, with solid deck at both ends** — otherwise walking towards the
stairs drops you through the floor.

**"How high is the ground?" is a question, not a constant.** `building/surfaces.ts`
answers it with the highest walkable surface at a point that is within one step
(`BUILDING_STEP_UP`) *below the walker's feet* — which is what makes the same
`(x, z)` mean "deck three" or "the grass" depending on where you came from.
`Player.groundSampler` is swapped to it in the `Game` constructor. Multi-storey
floors, stairs, escalators, the lift, the floating bubble and falling through a
hole are all consequences of that one rule; there is no physics engine.

A moving platform only has to implement `MovingPlatform` (`surfaceY` + `covers`)
and register with `WalkSurfaces.addPlatform`.

**The cutaway is per-floor groups.** `BuildingShell` puts each deck in its own
`Group`; `building/floorFade.ts` fades away every floor above the one the player
is standing on, which is the Theme Park doll's-house look. It claims each
material for the first floor that uses one and clones it for the rest, so
builders can share materials freely.

Two consequences worth knowing:

- **`BUILDING_PARAPET` is the whole exterior look.** Low, and the tower reads as
  a grey glass office block; high, and the 38° camera cannot see over the near
  wall into the floor you are standing on.
- **Collision is height-blind** (see `Collision.ts`), so a shop counter on deck
  two is also a wall on deck four. Shop units are placed so no two stack, and
  none of them block a doorway on the ground floor.

Riding a slide is scripted: `SlideRide` sweeps a chute along a curve *and* gives
the ride the same curve to drive the player along, so the geometry and the path
a child travels cannot disagree. `Player.beginRide` / `setRidePose` / `endRide`
take input, collision and gravity out of the loop while it happens.

To fit out a shop (build step 4):

```ts
const unit = game.world.building.shops.getGroup('toy');   // origin at the front
unit.add(myToyShop);                                       // of the unit, on its deck
game.world.building.shops.setPlaceholderVisible('toy', false);
```

### Placement is seeded

`Scenery` and `Garden` scatter using `Rng` from `core/mathUtils.ts` with fixed
seeds, so the park is laid out identically on every reload. No wandering trees
between playtests. Change a seed and you get a different park; change the count
and everything downstream of it shifts, so prefer adding a new seeded pass.

---

## Asset interface

Everything visible is currently generated from three.js primitives. This section
defines how to swap in authored models (from the `art/` pipeline) without
touching gameplay code.

### The contract

Every visual thing in the game is **a `THREE.Group` with its origin on the
ground, facing `+Z`, in metres.** That is the whole contract. If a supplied model
satisfies it, it drops in.

| Convention | Rule |
| --- | --- |
| **Units** | Metres. The player character is **1.86 m** tall — use it as the scale reference. |
| **Origin** | At the **feet / base**, centred in X and Z. Not the centre of the bounding box. A prop's origin sits where it meets the ground. |
| **Facing** | Model looks down **+Z** at zero rotation. `Player` sets `group.rotation.y` from `atan2(velocity.x, velocity.z)`, which assumes this. |
| **Up** | +Y. |
| **Ground** | Never bake in a height. Call `terrainHeight(x, z)` from `world/terrain.ts` and set `position.y` from it. |
| **Shadows** | Set `castShadow` and `receiveShadow` on meshes; nothing does it for you. |
| **Materials** | Toy objects — characters, props, walls, trees, the building fabric — use `toonMaterial()` from `src/art/style/materials.ts`. Ground, paths, water and glass keep `MeshStandardMaterial` with `metalness: 0`. Unlit elements (bulbs, signs, plot markers) use `MeshBasicMaterial` so they read correctly at every time of day. The park has no metal. See ART_DIRECTION.md §2. |
| **Colours** | From `core/palette.ts` where one fits. |

### Swapping the character model

`entities/CharacterModel.ts` is a thin adapter over `art/models/kid.ts`. It
exposes exactly what the animator in `Player.animate()` touches:

```ts
class CharacterModel {
  readonly root: Group;      // position this at the feet
  readonly body: Group;      // bobs, squashes, leans
  readonly head: Group;
  readonly leftArm, rightArm: Group;   // pivots at the shoulders
  readonly leftLeg, rightLeg: Group;   // pivots at the hips
  readonly height: number;             // used to place the name label
  readonly hatAnchor, holdAnchor, backpackAnchor: Group;
  setExpression(name: Expression): void;   // blink / happy / surprised / sad
  setWalkPhase(phase01: number, speed01: number): void;
  setSkinColour, setHairColour, setOutfitColour, setShoeColour(c: number): void;
}
```

**There are no eye meshes.** The face is a canvas texture on a curved patch
(ART_DIRECTION.md §3), so blinking is `setExpression('blink' | 'neutral')` — and
because it swaps a texture and flips `needsUpdate`, callers must only fire it on
a *transition*, never per frame.

An authored replacement must provide the same members. The important detail is
that **arm and leg pivots sit at the joint, not at the limb's centre** — a
rotation on `leftArm` swings the whole arm from the shoulder. If a supplied
model has limbs whose transform origin is at their midpoint, wrap each in an
empty `Group` positioned at the joint and re-parent.

`Player` never reaches past these members, so any model satisfying the interface
can be substituted by changing one line in the `Player` constructor.

### Dropping a build into an anchor plot

The five reserved plots are declared in `world/anchors.ts` (footprint, entrance,
sign text, accent colour) and built by `world/AnchorPlots.ts`. Each gets an empty
`Group` named `anchor:<id>`, positioned at the plot centre **with its origin on
the ground**, so contents are authored around `(0, 0, 0)`:

```ts
const plot = game.world.anchorPlots.getGroup('ferrisWheel');
plot.add(myFerrisWheel);                                  // local space
game.world.anchorPlots.setPlaceholderVisible('ferrisWheel', false);
```

Register anything solid with the shared collision world so the player cannot
walk through it:

```ts
game.world.collision.addCircle(x, z, radius);          // trunks, posts, rides
game.world.collision.addWall(x1, z1, x2, z2, 0.35);    // fences, walls
game.world.collision.addRectangle(cx, cz, hx, hz);     // buildings
```

Collision coordinates are **world space**, not plot-local.

### Textures

`core/textures.ts` generates and caches canvas textures by key. Authored image
textures should be added there behind the same cache so nothing is built twice,
and should set `colorSpace = SRGBColorSpace` for colour maps (not for roughness
or normal maps).

---

## Characters and drivers

The park has more than one child in it, and only one of them is you. What makes
that cheap is a split that is worth understanding before adding anything that
moves under its own steam.

**A character is a body with no opinion about where it should go.** It knows how
to accelerate, how to resolve against `CollisionWorld`, how to ask a
`GroundSampler` where the floor is, and how to drive a walk cycle off distance
travelled. It does not know whether it is being steered by a keyboard, a
behaviour script, or a recording.

**A driver supplies that opinion, one frame at a time**, as a `CharacterIntent`
(`entities/npc/driver.ts`):

```ts
interface CharacterIntent {
  moveX: number; moveZ: number;   // desired direction in WORLD space, 0..RUN_INTENT
  hop: boolean; interact: boolean; // edge-triggered
  lookAt: number | null;           // yaw to face while standing still
  expression: Expression;          // face hint; applied only on a transition
  wave: number;                    // 0..1 blend into the wave pose
}
```

`update(context, intent)` fills in an intent that is allocated once per
character and reused, so a driver never allocates. Implementations must write
**every** field — an NPC stuck mid-wave is always a driver that forgot to clear
`wave`.

The intent is deliberately shaped like a **gamepad snapshot rather than a
position**. That is the whole point:

| Driver | Character | Status |
| --- | --- | --- |
| local input | `entities/Player` | today, reading `InputSystem` directly |
| `WanderDriver` | `entities/npc/NpcCharacter` | today — the park's children |
| remote input, fed from packets | `entities/npc/NpcCharacter` | **a future networked player is not a new kind of character** |
| a recording | `NpcCharacter` | cut-scenes, ghost replays |

A networked player is the same body with a driver that fills the intent in from
the wire. Because both ends then run the *identical* movement and collision
code, a remote child accelerates, turns and bumps into the same wall in the same
place. Sending positions instead is what makes remote characters teleport and
slide.

`Player` predates this and still reads input directly. Converting it to a
`LocalInputDriver` is a small, obvious change and the point at which the two
bodies could merge into one.

### The children

`entities/npc/` is three pieces that barely know about each other:

| File | What it does |
| --- | --- |
| `kidCrowd.ts` | **Draws** them, by instancing a prototype of the same `createKid()` the player wears |
| `NpcCharacter.ts` | **Moves** them, with the player's movement code and collision world |
| `wanderDriver.ts` | **Decides** for them — the only file with anything to say about behaviour |
| `poiGraph.ts` | The waypoint graph they wander |
| `NpcSystem.ts` | Owns the crowd, spawns twelve children and two pets, ticks them |

**They walk a waypoint graph, not a steering behaviour.** There is no navmesh,
and a dozen children homing on the fountain across a park full of tree trunks
produces exactly what you would expect. Waypoints are authored to follow the
real path network in `world/paths.ts`; **edges are not authored**. Every
candidate pair is walked at build time and kept only if a character of NPC width
fits along the whole straight line, so a child cannot path through a wall, and
planting a tree across a shortcut removes the shortcut. That validation is why
`NpcSystem` is constructed last in `World` — it needs the finished collision
world.

**They are drawn by reading a prototype, never by re-authoring one.** A kid is
about twenty-five little meshes; twelve of them drawn the ordinary way is three
hundred draw calls. `InstancedCrowd` builds one throwaway kid, walks it, and
gives every *part* one `InstancedMesh` holding that part for every member. Each
member gets a **skeleton** — a mirror of the hierarchy made of empty
`Object3D`s — which you animate exactly as you would animate the real model;
`commit()` copies each proxy's world matrix into its instance slot.

The payoff is that the crowd inherits whatever the model file produces. Retune
the kid's proportions and the crowd picks it up on the next reload, because
nothing in `InstancedCrowd` knows what a kid *is*. Per-child colour comes from
`instanceColor` against one shared toon material, and the roles are discovered
by building the prototype with sentinel colours and seeing which materials come
back red, green or blue.

Three consequences worth knowing:

- **Colours are set at spawn, not per frame** — there is one material for the
  whole crowd, so a per-child colour change means rewriting an instance colour.
- **Instanced meshes are not frustum-culled.** An `InstancedMesh`'s bounding
  sphere is computed from where its instances *were*, and these walk about;
  culling against a stale sphere makes children blink out at the screen edge.
- **Only the three bulkiest parts cast shadows.** Every caster is drawn twice,
  and a child's shadow is a head and a body — nobody looks at the ground for
  their hair bobbles. The parts are chosen by bounding radius rather than by
  name, so a retune still picks whatever is now doing the silhouette's work.

Budget: **40 draw calls and ~310k triangles** for twelve children and two pets,
with no measurable frame-time cost on an M-series laptop. The triangle count is
the number to watch on a phone — the fix, if it bites, is packing visible
members to the front of the instance buffer and lowering `InstancedMesh.count`,
which is the only way to stop the GPU shading instances nobody can see.

---

## Adding things — quick recipes

**A new piece of scenery.** Build it in `world/`, take `CollisionWorld` in the
constructor if it is solid, expose a `group`, add it in `World`'s constructor. If
it animates, implement `GameSystem` and call its `update` from `World.update`.

**A new input action.** Add it to `core/input/actions.ts` with its keys and
gamepad buttons; `input.isDown('name')` and `input.justPressed('name')` then work
everywhere. Don't read `KeyboardEvent` anywhere else.

**A new HUD element.** Add it in `ui/Hud.ts`. The HUD is a *subscriber* — it
reacts to `gameStore` and never reaches into game systems. Per-frame values too
noisy for the store (the clock face, FPS) are pushed in via setters.

**New persistent state.** Add it to `state/types.ts` and a setter in
`state/store.ts`. The store notifies subscribers; it has no dependency on three.

---

## Known follow-ups

- The plot signs face the default camera angle so a child can read them without
  rotating the view; they are not readable from the three other 90° views.
- Sunset is dim on horizontal surfaces — physically right (the sun is grazing)
  but the grass could use an art-directed cheat.
- `dist/assets/index.js` is ~610 kB (159 kB gzipped), essentially all three.js.
  Worth code-splitting only if load time becomes a complaint.
- The children stay in the garden and on the building's ground floor. Stairs,
  the lift, the trampoline and the slides are all driven by `Building` against
  `Player` specifically, so letting an NPC ride one means generalising those
  hooks to any character — worth doing, and deliberately not done in the same
  change as introducing the NPCs.
- `Player` still reads `InputSystem` directly rather than through a
  `LocalInputDriver`; see "Characters and drivers".
- NPC tuning numbers (walk speed, spawn count, wave range) live in
  `entities/npc/` rather than in `core/constants.ts`, to keep a parallel branch
  out of a shared file. They should move.
