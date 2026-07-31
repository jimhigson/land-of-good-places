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
| **Units** | 1 unit = 1 metre. The player kid is **1.86 m** tall (matches `CharacterModel.height`). |
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
  setExpression(name: ExpressionName): void;   // 'neutral' | 'blink' | 'happy' | 'surprised' | 'sad'
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
| 17 | Building exterior + floors | L | Tall pastel tower, glass lift shaft, escalators, stairs, trampoline, bubble. |
| 18 | Ginormous slide + ball pit | L | Swept tube; ball pit = instanced spheres. |
| 19 | Candy floss / ice cream / egg / hat / sticker items | M | ~24 small held props. All ≤ 0.3 m, all with the same `heldOffset`. |
| 20 | Pet followers (bunny, kitten, mouse) | M | Also the "cute animal" player options — one rig, three skins. |
| 21 | Hats (8+) | S | Mount to `head` via a `hatAnchor` empty at the crown. |
| 22 | Backpack + peeking heads | M | Five shapes in `art/models/backpacks.ts` (`satchel`, `bubble`, `heart`, `ripikaHead`, `trillaHead`), chosen in the creator and rolled per NPC. Tagged per kind like hair, not built as separate assets — a bag is part of the body, never bought. The peek slot is `backpackAnchor`, which moves to the mouth of the shape worn. |
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
