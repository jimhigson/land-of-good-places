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
  trees, bushes and flowers cost a handful of draw calls. Current budget: about
  **306 draw calls / 285k triangles**, comfortably 120fps on an M-series laptop.

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
| **Materials** | `MeshStandardMaterial`, `metalness: 0`, `roughness` 0.5–1.0. The park has no metal. Unlit elements (bulbs, signs, plot markers) use `MeshBasicMaterial` so they read correctly at every time of day. |
| **Colours** | From `core/palette.ts` where one fits. |

### Swapping the character model

`entities/CharacterModel.ts` is the reference implementation. It exposes exactly
what the animator in `Player.animate()` touches:

```ts
class CharacterModel {
  readonly root: Group;      // position this at the feet
  readonly body: Group;      // bobs, squashes, leans
  readonly head: Group;
  readonly leftArm, rightArm: Group;   // pivots at the shoulders
  readonly leftLeg, rightLeg: Group;   // pivots at the hips
  readonly eyes: Object3D[];           // scaled on Y to blink
  readonly height: number;             // used to place the name label
  setOutfitColour(colour: number): void;
  setHairColour(colour: number): void;
}
```

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
