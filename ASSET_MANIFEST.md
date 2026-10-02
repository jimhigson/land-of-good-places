# Asset Manifest — Land of Good Places

Draft 1, by the Artist. **This is a negotiation document** — Architect and Builder
should edit priorities freely. Derived from `GAME_DESIGN.md`.

Style rules for every item live in `ART_DIRECTION.md`. Reference implementations
of the P0 characters live in `art/models/` and are visible in `art-samples.html`.

---

## The shared contract (applies to EVERY asset)

Every visual asset is a **factory function** that returns a fresh `THREE.Group`.
No classes unless the thing animates itself; no singletons; no shared mutable
geometry across instances that need different colours.

```ts
export interface AssetHandle {
  /** Root group. Parent it anywhere. */
  readonly root: THREE.Group;
  /** Total height in world units (metres). Used to place name labels. */
  readonly height: number;
  /** Called once per frame by whoever owns it. Optional. */
  update?(dt: number, elapsed: number): void;
  /** Frees geometry/materials this asset created. Optional but preferred. */
  dispose?(): void;
}

export function createThing(options?: ThingOptions): AssetHandle;
```

| Convention | Rule |
| --- | --- |
| **Units** | 1 unit = 1 metre. The player kid is **2.12 m** tall (`KID_HEIGHT`, `src/art/models/kid.ts`), and **2.97 m** in the tallest hair and hat (`TALLEST_CHILD_HEIGHT`, same file). **Import them; never type them.** |
| **Origin** | At the **feet / base**, centred on X and Z. `root.position.y = groundHeight` must sit it on the ground with no fudge. |
| **Facing** | Forward is **+Z**. `root.rotation.y = 0` means "looking at the camera in the default 45° iso view". Rotate the root only. |
| **Up** | +Y. Nothing is authored lying down. |
| **Scale** | `root.scale` left at 1. Bake size into the geometry so callers can use scale for squash-and-stretch. |
| **Shadows** | Every solid mesh sets `castShadow = true; receiveShadow = true`. Face decals, eye shines and glow sprites set both `false`. |
| **Naming** | `root.name` = the asset key, e.g. `'ripika'`, `'balloon.corgi'`, `'prop.lollipopTree'`. Sub-parts an animator needs are exposed as named fields, not looked up by string. |
| **Colour** | Only via `PALETTE` (`src/core/palette.ts`) or `ART.*` (`art/style/artPalette.ts`). No inline hex in model files. |
| **Materials** | `toonMaterial()` / `softMaterial()` from `art/style/materials.ts`. Never `MeshBasicMaterial` for anything solid. |
| **Randomness** | Seeded `Rng` from `src/core/mathUtils.ts`. Never `Math.random()` in a builder — the park must look the same on reload. |
| **Textures** | Canvas-drawn only, cached by key (follow `src/core/textures.ts`). Budget below. |

> **Both numbers were wrong here until 29 August 2026**, and this table said
> **1.86 m** — the pre-restyle height, which `ART_DIRECTION.md` §4 had already
> recorded as superseded on the same day the models grew. Nothing detected it,
> because a wrong number in a contract is not a failing test; it is a fact
> everyone builds on.
>
> It did real damage. A Blender render script typed the same 1.86 into the
> **scale post** its author stands beside every asset to judge its size — so the
> reference object in the picture was a quarter too short, and every human and
> agent who looked at those renders drew a confident wrong conclusion. A 2.60 m
> suit of armour was judged "towering" while actually being **shorter than a
> child in a tall hat**.
>
> The rule that follows is not "be careful with this number". It is: **an asset
> script must read a height out of `src/art/models/kid.ts` at build time, the
> way `art/blend/hotel_build.py` already reads `TALLEST_CHILD_HEIGHT` and
> `RIDER_HEADROOM`.** A typed copy in a `.py` file is invisible to `tsc`, to
> every check, and to the reader of the picture it distorts.

**Texture budget:** face patches 512², body/decal maps 256², tiling world maps
512² max, sign boards 512×288. Target: under 40 distinct canvas textures in the
whole game. Anything that is a flat colour must be a material colour, not a map.

**Animation hooks every creature exposes** (so the parade, the rides and Mayhem
can drive any of them with one bit of code):

```ts
interface CreatureHandle extends AssetHandle {
  readonly body: THREE.Group;    // bob / squash target
  readonly head: THREE.Group;    // look-at target
  readonly limbs: { leftArm; rightArm; leftLeg; rightLeg } | null;
  setExpression(name: ExpressionName): void;   // 'neutral' | 'blink' | 'happy' | 'surprised' | 'sad' | 'frown'
  setWalkPhase(phase01: number, speed01: number): void;
}
```

---

## P0 — needed for the next build steps (parade, shops, character select)

| # | Asset | Cx | Notes / interface |
| --- | --- | --- | --- |
| 1 | **Player kid** (`createKid`) | M | Already exists as `src/entities/CharacterModel.ts`. Artist proposes a **restyle in place** (toon material + canvas face + outline), same public API, plus `setSkinColour`, `setExpression`. 1.86 m. |
| 2 | **RiPika** | M | Electric yellow mouse. 1.05 m. Roams the park, rides dodgems, joins the parade, has a Space variant (helmet + tiny jetpack). |
| 3 | **Biscuit** | M | Teddy bear, red jumper, two hearts. 0.95 m. Parade + toy shop shelf + bedroom shelf. |
| 4 | **Balloon: dalmatian pup** | S | 0.62 m balloon body + 1.4 m string. Held: `attachTo(hand)`. |
| 5 | **Balloon: flying corgi** | S | Pink flying goggles, tiny wings. Grants high jump + slow fall. |
| 6 | **Balloon: Chicken-looter** | S | White + red chicken. Also needs a **walking** variant for Mayhem (P1). |
| 7 | **Mini** (Mayhem) | S | Lilac gremlin, 0.55 m. Needs `leg-grab` pose + a shout expression. |
| 8 | **Lollipop tree** | S | Exists in `src/world/Scenery.ts`. Artist proposes a variant set: `plain`, `blossom`, `fruit`, `tall`. Seeded. |
| 9 | **Pink stone wall segment** | S | Exists in `src/world/Scenery.ts`. Needs a **capped/coping** top and corner + gateway pieces. |
| 10 | **Wooden wall segment** | S | Three heights (0.8 / 1.4 / 2.2 m) for hide-and-seek. |
| 11 | **Name-label pill** | S | Exists (`src/ui/NameLabel.ts`). Reused verbatim for every creature. |

## P1 — shops, rides, collection

| # | Asset | Cx | Notes |
| --- | --- | --- | --- |
| 12 | Shop kiosk shell (7 skins) | L | One chunky building shell + swappable awning colour, sign glyph, counter props. Toy / balloon / candy floss / ice cream / hat / sticker+pet / surprise egg. |
| 13 | Ferris wheel | L | Hub, 12 spokes, 12 gondolas, night light strips. Gondola interior needs a window for the space show. |
| 14 | Dodgem car + arena | M | Car ~1.3 m, chunky bumper torus, pole + ceiling grid. Plus the **fake wooden tree** (wobble + apples + leaves + surprised bird). |
| 15 | Water gun + splash FX | M | Very big water gun prop; splash sprites; drippy-hair overlay; rainbow arc. |
| 16 | Wishing fountain | M | Exists (`src/world/Fountain.ts`). Wants a coin + sparkle burst. |
| 17 | Building exterior + floors | L | Tall pastel tower, glass lift shaft, escalators, stairs, trampoline. (The floating bubble was removed on 30 August 2026, issue #377.) |
| 18 | Ginormous slide + ball pit | L | Swept tube; ball pit = instanced spheres. |
| 19 | Candy floss / ice cream / egg / hat / sticker items | M | ~24 small held props. All ≤ 0.3 m, all with the same `heldOffset`. |
| 20 | Pet followers (bunny, kitten, mouse) | M | Also the "cute animal" player options — one rig, three skins. |
| 21 | Hats (8+) | S | Mount to `head` via a `hatAnchor` empty at the crown. |
| 22 | Backpack + peeking heads | M | Five shapes in `art/models/backpacks.ts` (`satchel`, `bubble`, `heart`, `ripikaHead`, `trillaHead`), chosen in the creator and rolled per NPC. Tagged per kind like hair, not built as separate assets — a bag is part of the body, never bought. The peek slot is `backpackAnchor`, which moves to the mouth of the shape worn. |
| 22b | Jet pack | S | `art/models/jetpack.ts`. Built like a hat, not like a backpack (it is sold, displayed and swapped), so it is a factory + anchor rather than a tagged-part rig. Origin is the **mount point on the back**, so `jetpackAnchor.add(pack.root)` needs no offset maths; `check:assets` knows the `gear.` prefix alongside `hat.`. `createJetpack(scale)` shrinks it for a follower, and `setThrust(0..1)` lights the painted flames. Hides the wearer's own bag while it is on. |
| 23 | Cute-o-dex + bedroom shelves | M | UI-adjacent; needs consistent 3D icon renders. |

## P2 — space show, Mayhem dressing, polish

| # | Asset | Cx | Notes |
| --- | --- | --- | --- |
| 24 | Space set: Earth, Moon, planets, stars | M | Seen from the top of the wheel. |
| 25 | Alien + flying saucer | S | Waves. |
| 26 | Space RiPika (helmet variant) | S | Reuses RiPika + helmet + tether. |
| 27 | Confetti / hearts / sparkles / splash particles | S | **The only billboard sprites in the game.** One shared `Points`/sprite pool. |
| 28 | Surprise eggs + crack FX | S | |
| 29 | Mayhem dressing | M | Boarded shops, bare tree stumps, warning signs, damaged dodgems. |
| 30 | Photo-mode frame | S | 2D overlay, cute border. |
| 31 | Coin | S | Dropped on death, stolen by Chicken-looter. |

---

## Authored geometry — the Blender kits

Most of this game is built from primitives in TypeScript. A few things are not,
because they are *architecture* rather than props: shapes with tracery, mitres,
mouldings and coursed stone that a `BoxGeometry` cannot express and a reader
cannot follow. Those are modelled in Blender, exported to glTF, and packed into
a base64 module so the game imports geometry the same way it imports anything
else.

**The Python is the authoring source. The `.blend` is a build artefact.** Edit
`art/blend/<kit>_build.py` and re-run; never open the `.blend` and save over it,
because the next run will discard whatever you did. `art/blend/blendkit.py` is
the shared toolkit — primitives, scene plumbing, planar UVs, and `ts_const`,
which reads a number out of the game's TypeScript rather than letting a Blender
script keep its own copy of it.

**Not every kit uses it yet, and that is a known debt rather than a choice.**
`blendkit.py` arrived with the castle (29 August 2026); `hotel_build.py` and
`bridge_stones_build.py` predate it and each carry their own `ts_const`,
`reset_scene`, `emit` and `box`. Three copies of the same four functions is
this repo's most common bug in its purest form. They were left alone
deliberately — both have a shipped `.glb` whose bytes are asserted by its
`pack:` step, so re-pointing them means re-verifying two binaries for no
visible change — but **a new kit must import `blendkit`, never copy from a
neighbour.** Folding the other two in is worth doing on its own PR, where the
only question asked is whether the bytes still match.

| Kit | Build | Bytes | What it is |
| --- | --- | --- | --- |
| `kid.glb` | `npm run blend:kid` | — | the child rig, round-tripped |
| `cart.glb` | `npm run blend:cart` | — | the rail-race cart |
| `duckbar.glb` | `npm run blend:duckbar` | — | the duck bar |
| `hotel.glb` | `npm run blend:hotel` | 640 KB | the hotel's 19 interior factories |
| `bridgeStones.glb` | `npm run blend:bridge-stones` | 9.2 KB | the railway bridges' coping, voussoirs and keystone |
| `castle.glb` | `npm run blend:castle` | 128 KB | the castle interior, batch 1 — 23 nodes, 4 342 triangles |
| `gateArch.glb` | `pnpm run blend:gate-arch` | 63 KB | the park's entrance arch — 5 nodes, 2 492 triangles |
| `reptileHouse.glb` | `pnpm run blend:reptile-house` | 250 KB | the Reptile House's exterior, "Sunny" — 13 nodes, 10 680 triangles |
| `reptileCases.glb` | `pnpm run blend:reptile-cases` | 154 KB | the Reptile House's enclosure masonry — 16 nodes, 5 674 triangles |
| `reptilePlants.glb` | `pnpm run blend:reptile-plants` | 171 KB | the Reptile House's plant kit — 23 nodes, 5 518 triangles |
| `reptileCreatures.glb` | `pnpm run blend:reptile-creatures` | 124 KB | the Reptile House's creature parts — 13 nodes, 4 452 triangles |
| `reptileNoodle.glb` | `pnpm run blend:reptile-noodle` | 112 KB | Noodle the python and her rock — 8 nodes, 4 982 triangles |
| `reptileStall.glb` | `pnpm run blend:reptile-stall` | 73 KB | Scales & Tails' dressing and the Noodle-o-meter — 17 nodes, 2 449 triangles |

**Two shapes of kit, and the difference matters.** Some are *models* a placer
puts down whole (the castle's furniture, the hotel's fittings); some are **kits
of repeating units a generator assembles itself** (the bridge stonework). Both
obey the shared contract above — metres, origin at the base centred on X/Z, +Z
forward, +Y up, `scale` 1, size baked into the geometry, one named node per
part — and both ship through the same `.glb` pipeline. They differ only in who
decides where the pieces go.

### 32 — Bridge stonework (`src/art/models/bridgeStones.ts`)

Parts: `coping`, `voussoir`, `keystone`. The humpback railway bridges' modelled
stone — Jim, 2026-08-29: *"modelled stoneworks (not just textures) around the
tops of the walls, a genuine arch-shaped tunnel with modelled archway masonry
around its edge"*. `art/blend/bridge_stones_build.py` →
`art/blend/bridgeStones.blend` → `src/art/assets/bridgeStones.glb` →
`bridgeStonesGlb.ts`. `src/world/train/bridgeStonework.ts` places them: a
voussoir ring round each tunnel mouth, laid on the *same* three-centred arch
curve the tunnel is cut to, and a coping run along both parapets, each baked
into one `BufferGeometry` per bridge. **`bridgeStones.ts` owns every dimension**
and the Blender script reads them back out of it with `ts_const` — one
definition, not two. Renders: `art/renders/bridge-{iso,arch,coping,silhouette}.png`.

**Why a kit and not a model.** A bridge here is solved per crossing — variable
span, two variable ramps, a crown height solved against the terrain — and it
follows the drawn path's own curve. No rigid `.glb` can be that. Anything else
in the park with the same shape (fence runs, wall coursing, path edging) should
follow this route rather than inventing a third one.

### 33 — Castle interior, batch 1 (issue #363)

Ten assets, built for the castle-interior Engineer against a written size
contract: **armour, plinth, tapestry, tapestry rail, sconce, throne, table,
bench, feast props, chest.** `art/blend/castle_build.py` is the source;
`HANDOFF-castle-assets.md` §2 is the reconciliation log — the measured sizes,
`SCONCE_CUP_OFFSET`, `TABLE_TOP`, `BENCH_SEAT` and the armour's keep-out radius,
each one measured off the built mesh and printed on every run.

Three rules this kit is built to, all of them learned from something that went
wrong before:

- **The GLB carries geometry and nothing else.** No colour, no material, no
  texture. `castleAssets.ts` owns every colour in a `STYLES` table keyed by node
  name, and a node with no entry throws at load rather than rendering grey.
  A `.glb` that carries its own colours is a second palette nobody can grep.
- **Nothing is measured twice.** Every size in the contract is asserted against
  the emitted vertices, so the document and the mesh cannot drift apart in
  silence — which is this repo's most common bug, and the reason the Engineer's
  own check re-derives the same numbers independently. It is the same rule the
  bridge kit follows with `ts_const`, pointed the other way: there, the
  TypeScript owns the number and Blender reads it; here, the mesh owns the
  number and both documents are checked against it.
- **`npm run render:castle` reads the geometry from the `.blend` and the colours
  from `castleAssets.ts`, and copies neither.** It writes review pictures to
  `art/renders/castle/`. This exists because the bridge kit's *build* script
  read its constants from TypeScript properly while its *render* script
  hand-copied them: the two drifted, and five committed renders were of a bridge
  that was not on the branch. A picture of the wrong thing is exactly as
  convincing as a picture of the right one, so no renderer here gets its own
  copy of anything.

**Look at the renders.** Four faults in batch 1 passed every assertion and were
obvious the moment somebody looked: a sword modelled *through* the skirt it hung
beside, a tapestry whose depth allowance made it a flat rectangle, a throne that
read as an armchair, and one render that was a picture of its own preview floor.
A build can prove an asset is the right size. Only a picture can say whether it
is the right shape.

---

## Open questions for the Architect / Builder

1. **Material switch.** Artist recommends `MeshToonMaterial` + a shared 4-step
   gradient ramp for all *toy* objects (characters, props, buildings, rides) and
   keeping `MeshStandardMaterial` for terrain / water / glass. That changes
   existing `softMaterial()` call sites in `Scenery`, `Fountain`,
   `CharacterModel`. Is a one-shot swap acceptable, or should toon be opt-in for
   new assets only?
2. **Where does shared art code live?** Artist proposes moving
   `art/style/{materials,faces,artPalette}.ts` into `src/art/` once the Builder
   is out of those files, so the game can import it. Say the word and the Artist
   will hand over a patch rather than editing.
3. **Faces.** Artist replaces geometric eyes with a **canvas face patch** (a
   curved shell hugging the head). Big win: blinking and expressions are a
   texture swap, and eyes can be much larger and more expressive than spheres
   allow. Confirm the Builder is happy for `CharacterModel` to change internals.
4. **Parade / follow interface.** Who owns it? Artist assumes every creature is
   just an `AssetHandle` and the parade system drives `setWalkPhase`.
5. **What does the Builder need first?** Artist will hand over finished model
   files in the order you name. Current default order: RiPika, Biscuit, kid
   restyle, three balloons, mini.
6. **Instancing.** Trees/bushes/wall segments are the only high-count items.
   Should the Artist author them as `InstancedMesh`-friendly (one geometry, one
   material, per-instance colour) or is per-object fine at current counts?

### 34 — The park entrance arch (`src/art/models/gateArch.ts`)

Nodes: `gate-arch-piers`, `gate-arch-band`, `gate-arch-bobbles`,
`gate-arch-sign`, `gate-arch-medallion`. The gate over the park's main entrance
— Jim, 2026-09-03: *"a decorative arch, designed in Blender, with a project
logo of a ferris wheel and 'LAND OF GOOD PLACES' written onto it"*, and on the
logo: *"yeah it is fine to just be a texture for the design"*.

`art/blend/gate_arch_build.py` → `art/blend/gateArch.blend` →
`art/blend/gate_arch_export.py` → `src/art/assets/gateArch.glb` →
`gateArchGlb.ts`. `createGateArch()` assembles all five nodes at one origin —
**the middle of the gateway, on the ground**, facing **+Z, which is out of the
park at the arriving child**. Renders: `art/renders/gate-arch-{walk-up,
walk-up-near,iso,three-quarter,logo,under,from-inside}.png`, by
`pnpm run render:gate-arch`.

Measured on the built mesh, printed by every build run: **8.16 m** to the top
of the roundel, a **7.00 m** clear opening between the piers, and **0.630 m**
of headroom over `TALLEST_CHILD_HEIGHT` under the sign plank.

**Collider: two circles, one per pier, radius 0.80 m at
`x = ±ENTRANCE_GATE_HALF_WIDTH`, and nothing else.** Everything else in the
asset is over 3.5 m up. `GATE_ARCH_PIER_KEEP_OUT` and `GATE_ARCH_CLEAR_WIDTH`
are derived from the shipped vertices so a placer never types either.

Three things this kit is built to:

- **The gateway's numbers belong to the game.** `ENTRANCE_GATE_HALF_WIDTH`,
  `ENTRANCE_GATE_POST_HEIGHT` and `TALLEST_CHILD_HEIGHT` are read with
  `ts_const` at build time, and `gateArch.ts` re-measures the shipped mesh
  against the same constants **at load** and throws. A rigid `.glb` of a gateway
  the park sizes for itself can go stale; it must not go stale quietly.
- **The lettering and the logo are painted into the arch's own UV space**, on
  the only two nodes that carry UVs. No second mesh tracking a first one's
  surface (`src/art/models/CLAUDE.md`).
- **One renderer, of the real thing.** `scripts/render-gate-arch.mts` drives
  headless Chromium over `gate-arch.html`, which imports `createGateArch()` and
  a real `createKid()` for scale. A Blender render could only show the shape, or
  else keep a second copy of the painting code — which is §32's bug exactly.

**Two traps found by looking at the picture, both invisible to every
assertion.** Worth knowing before painting the next authored surface:

- **UVs authored in Blender arrive with `v` inverted.** The exporter writes
  `1 − v`, because glTF's texture origin is top-left and Blender's is
  bottom-left. The sign shipped upside down and the mesh, the canvas and the UV
  layout were each individually correct.
- **`blendkit.revolve` cannot carry a painted surface.** Its profile closes on
  the axis, leaving degenerate faces at each pole; `Part.emit`'s
  `remove_doubles` collapses them, the polygon indices shift, and `Part`'s
  per-face UV table — keyed by index — lands on the wrong polygons. The roundel
  smeared into radial wedges. The fix is `paint_planar_uvs()`, which computes
  UVs from **where each vertex is**, after emit: a UV that is a function of
  position cannot be given to the wrong face.

### 35 — The Reptile House exterior, "Sunny" (`src/art/models/reptileHouseAssets.ts`)

Nodes: `rh-plinth`, `rh-coil`, `rh-coil-belly`, `rh-coil-spots`, `rh-house-wall`,
`rh-windows`, `rh-head`, `rh-mouth`, `rh-tongue`, `rh-tail`, `rh-tail-bell`,
`rh-sign`. "Sunny, the snake who is the building" — a mint snake coiled 1.86
turns round a cream greenhouse, **her head on the ground in front of the door
with her mouth open: the mouth is the door** (Jim, 2 October 2026: *"Why
beside the door and not the door as its mouth? That sounds cooler so do
that."*), the neck lifting up over the humped first coil and diving into the
back of the crown, the tail curling down beside the head as the signpost
(`docs/design/REPTILE-HOUSE.md` §2). Jim, 2026-10-02: *"The outside of the
building should be snake-themed too."*

`art/blend/reptile_house_build.py` → `art/blend/reptile_house.blend` →
`reptile_house_export.py` → `src/art/assets/reptileHouse.glb` →
`reptileHouseGlb.ts`, by `pnpm run blend:reptile-house`. Renders:
`art/renders/reptile-house/{iso,door,head,back}.png`, by
`pnpm run render:reptile-house`. 12 nodes, 10 102 triangles, 255 408 bytes.

Origin on the ground at the building's centre, facing **+Z** (the door and
the head face +Z; the plot is `cameraFacing`). Measured on the built mesh,
printed by every build run: **12.25 m** to the top of the humped coil,
furthest vertex **11.82 m** from the centre — the tongue's fork — (≤
`REPTILE_BOUNDING_RADIUS` 12), plinth 16-gon circumradius **9.400** =
`REPTILE_SHELL_RADIUS` (flats at 9.219, top at y 0.30), the mouth's bore
**3.40 × 3.60** above the plinth top with the lips 10.60 m out at the top and
10.34 at the floor (≥ `REPTILE_DRAWN_DOOR_ALONG`), the coil's nearest pass
0.27 m off the head's skin, the neck 0.22 m over the first pass, the tail
touching down 0.40 m from the `REPTILE_TAIL_REACH` point (7.20, 8.58 in game
XZ; bearing offset 40°).

The head is an 8.4 × 4.6 × 8.8 m ellipsoid sunk 2.4 m into the ground (so its
chin is wide where the mouth is) with the doorway bored through it by a
boolean; `rh-mouth` is the old snake-hole tunnel intersected with the head
and the bore cut back out — a 0.4 m pink lining that shows on the face as
lips, the head's own hole cut 0.04 m smaller so the lining's skin sits inside
the flesh and no two faces share a plane. `rh-tongue` is the doormat: a flat
ribbon from the mouth's floor on the plinth, over its edge and down onto the
paving, forking at the tip, standing 0.05 m off the plinth top and the paving.

Every shared number is read from `src/world/reptileHouse/layout.ts` through
`art/blend/reptile_constants.py` (plus `snakeFace.ts`'s `SUNNY_FACE_EYE_ROW`,
which the build asserts lands above the lips); the loader re-asserts the
plinth circumradius, the mouth's outer size and the bounding radius at load,
as `gateArch.ts` does. The collider is the closed 16-gon ring at
`REPTILE_SHELL_RADIUS` with one aperture, jambs flush with the bore running
from the back wall to where the lips reach (`reptileHouseLipsReach`, off the
mesh) and the back wall (`world/reptileHouse/shell.ts`), plus discs derived
from every vertex of the head, the mouth, the tail and the sign between the
ground and `TALLEST_CHILD_HEIGHT` outside the ring and outside the doorway
strip (`reptileHouseLowDiscs`) — `check:reptile-house` marches at it from 32
bearings.

Two painted nodes carry UVs: `rh-head` (planar face UVs on the front
hemisphere only, `u` with +X, `v = (hi − z)/h` to cancel the exporter's 1−v
— identical to `gate-arch-sign`'s convention; the back hemisphere is parked
at UV (0.02, 0.02), which the canvas leaves as plain body colour) wearing
Sunny's own face (`snakeFace.ts`'s `sunnyFaceTextures`: eyes and blush, no
painted mouth), and `rh-sign` (a 1.70 × 0.85 plank, planar UVs on all faces)
dressed from the hall's sign atlas. **That convention wants `flipY` on** —
`art/style/glb.ts`'s `planarUvCanvasTexture`, never `glbCanvasTexture`
(which is for kits authored the glTF way, like the hotel's signboard);
painted through the wrong one, the face is upside-down and the plank reads
rotated, which is how the first cut shipped (2 October 2026). `rh-tongue` is
the one node with a transform: a pure translation to its root on the mouth's
floor (0.00, 0.00, 8.00 in game XYZ), so a wag is a yaw on the node.

### 36 — Reptile House: enclosure masonry, the `cases` kit (`src/art/models/reptileCasesAssets.ts`)

Nodes: `rc-case-plinth`, `rc-case-rim`, `rc-case-backboard`,
`rc-case-backboard-relief`, `rc-pier-post`, `rc-pier-vine`, `rc-jar-base`,
`rc-jar-rim`, `rc-round-wall`, `rc-lagoon-wall`, `rc-tortoise-wall`,
`rc-nursery-kerb`, `rc-nursery-rail`, `rc-island-kerb`, `rc-grotto-rock`,
`rc-grotto-moss`. Asset group §2 of `docs/design/REPTILE-HOUSE.md`.

`art/blend/reptile_cases_build.py` → `art/blend/reptile_cases.blend` →
`art/blend/reptile_cases_export.py` → `src/art/assets/reptileCases.glb` →
`reptileCasesGlb.ts`. 16 nodes, 5 674 triangles, 154.2 KB (budget 180).
Renders: `art/renders/reptile-cases/{case,case-front,enclosures,grotto,
grotto-front}.png` by `pnpm run render:reptile-cases`.

Every node is authored about its own footprint centre, on the floor, identity
transform, Blender −Y = game +Z (a case's glass front faces +Z; a west-wall
case is the same nodes rotated at the root). Every grounded node is sunk
0.05 m below the floor with **no bottom face**, so nothing shares the floor
plate's plane. No UVs, no colour: one node per colour, the loader's STYLES
table owns every colour. Glass panes and nameplates are TypeScript.

**Every footprint is `layout.ts`'s, read with `ts_const` and asserted off the
emitted vertices on every build, and re-measured by the loader at load** —
the collider always encloses the stone: `rc-case-plinth`/`rc-case-rim` the
stadium `REPTILE_CASE_SEGMENT` × half `REPTILE_CASE_HALF_DEPTH`, plinth top
`REPTILE_CASE_PLINTH_HEIGHT`, rim from `REPTILE_GLASS_TOP`; `rc-pier-post` +
`rc-pier-vine` within `REPTILE_PIER_POST_RADIUS`; the three walls' tops
exactly `REPTILE_ENCLOSURE_WALL_HEIGHT` and reaches `REPTILE_ROUND_WALL_RADIUS`
/ the lagoon and tortoise stadiums; `rc-nursery-kerb` r
`REPTILE_NURSERY_RADIUS`, `rc-nursery-rail` to `REPTILE_NURSERY_RAIL_TOP`
(its XY reach is the nursery glass radius, measured as
`REPTILE_NURSERY_GLASS_RADIUS`); `rc-island-kerb` r `REPTILE_ISLAND_RADIUS`;
`rc-jar-base` foot `REPTILE_JAR_RADIUS + 0.15`. `rc-grotto-rock` is
mesh-owned (6.68 wide × 5.09 deep × 3.54 tall, pool basin at local (+0.30,
+1.30), waterfall lip at (+0.30, +0.45, 2.10)) and stands in the grotto bed,
whose discs are its collider.

### 37 — Reptile House plants (`src/art/models/reptilePlantsAssets.ts`)

Nodes: `rp-palm-trunk`, `rp-palm-frond`, `rp-banana-leaf`, `rp-monstera-stalk`,
`rp-monstera-leaf`, `rp-fern-frond`, `rp-heliconia-stalk`, `rp-heliconia`,
`rp-vine-strand`, `rp-vine-leaves`, `rp-lily-pad`, `rp-rock-a/b/c`,
`rp-log-small`, `rp-log-hollow`, `rp-log-knothole`, `rp-banyan`,
`rp-banyan-canopy`, `rp-banyan-anchor-a/b/c`, `rp-branch`. A kit of
instancing units for the Reptile House's beds (spec §5):
`art/blend/reptile_plants_build.py` → `reptile_plants.blend` →
`reptile_plants_export.py` → `src/art/assets/reptilePlants.glb` →
`reptilePlantsGlb.ts`. 23 nodes, 5 518 triangles, 171 KB. Shared numbers
(`REPTILE_LOG_*`, `REPTILE_PALM_HEIGHT`, `REPTILE_BANYAN_HEIGHT`,
`TALLEST_CHILD_HEIGHT`) are read from `src/world/reptileHouse/layout.ts` /
`kid.ts` through `reptile_constants.py`, never typed, and the loader
re-measures the palm, the banyan and the hollow log's bore. Shape only; no
UVs; colours from the loader's STYLES table. Renders:
`art/renders/reptile-plants/*.png`.

Everything stands at origin, base centred on X/Z, bottoms sunk 0.05 m so no
face is coplanar with the floor plate; leaves point along game +Z; logs lie
along game X. Four nodes carry a node translation and nothing else, read with
`reptilePlantAnchor` rather than copied: `rp-log-knothole` (0, 1.25, −1.67)
on the hollow log's north inner wall, where hidden baby #1 peeks; the three
banyan hang points below the canopy skirt. The anchor tetrahedra are never
drawn. `rp-vine-strand`/`rp-vine-leaves` hang from their origin (2.6 m drop).
The hollow log is a sagged, split log: vertical inner walls at exactly
y = ±`REPTILE_LOG_INNER_RADIUS` (the Log Walk's two thick-wall colliders), a
3.30 m clear bore, and the south side cut away so the camera sees her inside.
Rocks' tops 0.65 / 0.42 / 0.52 m and circumradii 1.054 / 0.690 / 1.519 m are
measured in TypeScript (`reptilePlantTop`, `reptilePlantRadius`) for the
hop-on plates and discs; `instancedPlant` makes one `InstancedMesh` plus an
ink-outline `InstancedMesh` sharing its matrices per part.

### 38 — Reptile House creature kit (`src/art/models/reptileCreaturesAssets.ts`)

Thirteen nodes, `docs/design/REPTILE-HOUSE.md` §ASSET GROUPS 4: `rr-snake-head`
(PAINTED), `rr-snake-tongue`, `rr-croc-head`, `rr-croc-jaw`, `rr-croc-body`,
`rr-croc-tail`, `rr-tortoise-shell`, `rr-tortoise-head`, `rr-chameleon-body`,
`rr-frog-body`, `rr-gecko-body`, `rr-skink-body`, `rr-iguana-body`. The
organic parts primitives fight; every animal is otherwise TypeScript
(`snake.ts`, `reptiles.ts`).

`art/blend/reptile_creatures_build.py` → `reptile_creatures.blend` →
`reptile_creatures_export.py` → `src/art/assets/reptileCreatures.glb` →
`reptileCreaturesGlb.ts`; `pnpm run blend:reptile-creatures` runs all three.
Renders: `art/renders/reptile-creatures/*.png`. **4 452 triangles, 124.2 KB**
(budget 4 500 / 140 KB). No rig, no bones, no materials: shape only. One
game-owned number, `REPTILE_SNAKE_HEAD_LENGTH` (`layout.ts`, 0.42 m), read
with `ts_const`, asserted off the vertices and re-measured by the loader.

Conventions: 1 unit = 1 m; every creature faces +Z; origin on the floor under
its belly, centred — except the snake head (origin at the **neck joint on the
body axis**, head extending 0.42 m forward) and the four **hinge-origin
nodes**, whose node carries a pure translation: `rr-snake-tongue` at the mouth
(scale along its length to flick); `rr-croc-jaw` (rotate about X to yawn);
`rr-croc-tail` (yaw to sway); `rr-tortoise-head` (translate along +Z to stretch
the neck). Snappy's four nodes assemble to 3.60 m in one group.

**Snake-face UV contract** (shared with `rn-head` and `rh-head` so one canvas
fits all three — `snakeFace.ts`): front faces take u across the head's full X
extent and v down its full height, back faces are parked at (0.02, 0.02). The
other animals' faces are geometry (ink eye blobs, catchlights, blush, a
w-mouth — `reptiles.ts`'s `geometryFace`), so the hall spends no canvas on
them.

### 39 — Noodle, the python, and her rock (`src/art/models/reptileNoodleAssets.ts`)

Parts: `rn-mound`, `rn-coil`, `rn-coil-belly`, `rn-coil-spots`, `rn-head`
(PAINTED), `rn-tongue`, `rn-burrow`, `rn-tail-mound`.
`art/blend/reptile_noodle_build.py` → `art/blend/reptile_noodle.blend` →
`reptile_noodle_export.py` → `src/art/assets/reptileNoodle.glb` →
`scripts/pack-reptile-noodle-asset.mts` → `reptileNoodleGlb.ts`. 8 nodes,
4 982 triangles, 112 KB. Every shared number is read through
`art/blend/reptile_constants.py` from `src/world/reptileHouse/layout.ts`
(`REPTILE_NOODLE_BODY_RADIUS`, `REPTILE_NOODLE_MOUND_HEIGHT` — the mound peak
is asserted to it in Python and at load — `REPTILE_NOODLE_HEAD_X/Y/Z`,
`REPTILE_ISLAND_RADIUS`, `REPTILE_NURSERY_RADIUS`). Island nodes are baked in
hall-local metres (the island is at the hall origin); `rn-tail-mound` is
authored at its own base origin for the nursery. Two nodes carry a pure
translation as their pivot: `rn-head` at the chin's rest point (2.3, 0.5, 2.3)
— yawed to track a child, lifted to say hello — and `rn-tongue` at the mouth,
scaled 0 → 1 to flick. The head's face is the shared snake canvas in its own
UVs. Her snout reaches 3.90 m from the hall origin, 0.30 m past the island's
collider: the loader measures it (`snoutReach`) and `exhibits.ts` registers
one small disc under it from that measurement. Renders:
`art/renders/reptile-noodle/*.png`.

### 40 — Reptile House stall kit (`src/art/models/reptileStallAssets.ts`)

`art/blend/reptile_stall_build.py` → `art/blend/reptile_stall.blend` →
`reptile_stall_export.py` → `src/art/assets/reptileStall.glb` →
`reptileStallGlb.ts`. Two frames in one file, told apart by prefix. **Stall
dressing** (`rs-awning`, `rs-awning-posts`, `rs-awning-snake`, `rs-finial`,
`rs-sign`, `rs-stall-snake-{face,shine,tongue,spots}`) is authored in
**`kiosk.ts`'s own frame** — origin at the stall base, counter toward +Z — so
it is added to the counter group at its origin with no offset: the scalloped
cloth spans the counter (front eave underside 3.25 m, back 3.85 m, top
3.92 m), its two posts stand through the counter's top plank, the eave snake
lies along the front hem with its head lifted at the near corner, and the
finial coil stands on the awning's back ridge (top 4.87 m). **The
Noodle-o-meter** (`rs-meter-post`, `rs-meter-bands`, `rs-meter-board`,
`rs-meter-snake`, `rs-meter-snake-{face,shine,tongue,spots}`) is authored
about its own base: post 3.20 m (`REPTILE_METER_POST_HEIGHT`, asserted at
load), 6 bands every `REPTILE_BABY_SNAKE_UNIT`, board top 3.59 m, base disc
radius **0.340 m**, measured for its collider. Measured headroom in front of
the counter: **+0.280 m** over `TALLEST_CHILD_HEIGHT` (asserted at load). Only
`rs-sign` (1.50 × 0.50 m) and `rs-meter-board` (1.00 × 0.45 m) carry UVs,
planar, `v = (hi − z)/h` the gate arch's way — so they are dressed with a
`flipY = true` canvas (`planarUvCanvasTexture`) from the hall's sign atlas,
each in a cell painted at the plank's own measured aspect. No rig,
no hinges, no animation, no materials. Renders:
`art/renders/reptile-stall/*.png` by `pnpm run render:reptile-stall`.
