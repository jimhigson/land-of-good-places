# Art Direction — Land of Good Places

The style bible. If you are about to add anything the player can see, read this
first. Reference implementations live in `art/models/`; you can look at all of
them at once by running `npm run dev` and opening **`/art-samples.html`**.

The client is Eleri, age 6. The bar is not "looks nice" — it is **"CUTE!"** said
out loud on sight.

---

## 1. The one-paragraph version

Everything in this park is a **painted wooden toy**. Chunky rounded shapes, no
sharp edges, no thin parts, no realistic proportions. Colours are bright but
softened towards cream, and the darkest value anywhere is a warm plum
(`PALETTE.ink`, `0x4a3a52`) — **there is no black in this game**. Toys are
toon-shaded with a gentle four-band ramp; ground, water and glass are not.
Faces are painted onto a curved patch, not built out of geometry. Every
character has eyes far bigger than anatomy allows, and a blush.

---

## 2. Materials — the decision

| Thing | Material | Why |
| --- | --- | --- |
| Characters, creatures, props, shop shells, ride parts, walls, trees | `toonMaterial()` — `MeshToonMaterial` + shared 4-band ramp | Flat, sticker-bright, holds its colour at distance |
| Terrain, paths, water, glass, sky | `softMaterial()` — `MeshStandardMaterial`, roughness ~0.62, metalness 0 | Banding a 140-metre lawn looks like a rendering bug, not a style |
| Outlines, eye catchlights, effects | `MeshBasicMaterial` | Must not shade |

**Never** use `MeshBasicMaterial` for anything solid, and never set `metalness`
above 0. A toy in this park is matte painted wood, not plastic.

### The toon ramp

`TOON_RAMP = [0.42, 0.64, 0.85, 1.0]` (linear light space, in
`art/style/materials.ts`). Four bands, boundaries at N·L = −0.5, 0, +0.5.
Perceived brightness comes out around 68% / 82% / 94% / 100%.

It is **deliberately gentle**. Hard two-tone cel shading reads as "anime
action", not "soft plush toy". The lit side must stay the true palette colour
and the shadow side must obviously be the same colour, only cosier.

> Do not darken the first band. Every time someone drops it below ~0.35 the
> whole park looks like it is under a storm cloud.

### Outlines

Inverted-hull, via `addOutline(mesh, thickness)`. Vertices are pushed along
their own normals **in local metres** and drawn back-face-only, so the line
stays an even width on squashed and stretched parts — which matters, because
almost every part of every character here is a squashed sphere.

- Thickness: **0.010–0.014** on small creatures, **0.016–0.022** on the kid and
  on props. Scale with the object, not with the camera.
- Colour: `inkTint(baseColour)` — the part's own colour mixed 62% toward the
  plum ink and darkened. **Never black.** A black line around a pastel yellow
  mouse looks like clip-art; a dark-plum-yellow line looks hand-painted.
- Apply **only to silhouette parts**: head, body, ears, limbs, big props.
  Outlining every little sphere fills the character with internal lines and it
  stops reading as one creature.

---

## 3. Faces — painted, not built

Every character wears a **face patch**: a thin curved shell hugging the front of
the head sphere, carrying a transparent canvas texture
(`createFacePatch()` in `art/style/faces.ts`).

This is the highest-leverage decision in the whole art direction:

- eyes can be far bigger than sphere geometry allows before they poke out of the
  skull, and big eyes are 80% of cuteness;
- blinking and expressions are a **texture swap**, not an animation rig;
- the shell curves with the head, so eyes wrap correctly at the iso angle
  instead of sliding off the way a flat decal does;
- it costs one draw call and one canvas per expression set.

### Canvas sizes (the whole game sticks to these)

| Use | Size |
| --- | --- |
| Hero heads (player kid, RiPika, Biscuit) | 512² |
| Small creatures, muzzles, balloon animals | 256² |

### Drawing rules

**The governing rule for anything painted:** a texture should look like
something that *could have been* built as geometry, just wasn't — for
curvature, cost, or animation reasons. Flat colour fills, bold well-defined
ink outlines, shapes with a clear silhouette. Not shading, not gradients
across a whole shape, not photographic or painterly rendering — a painted
texture must read in the same visual language as the toon-shaded primitives
sitting right next to it, or the model looks like two different games glued
together. The soft touches below (blush airbrush, iris gradient) are
deliberate, bounded exceptions — a few percent of a small shape — not a
licence for painted detail generally.

- **Ink**: fill with `PALETTE.ink`. Never `#000`.
- **Eyes**: one solid ink oval, **taller than wide** (height ≈ 1.3 × width). No
  white sclera — cartoon toys read cuter with a full dark eye.
- **Size**: `eyeW` ≥ **0.10** of the patch, `eyeH` ≥ 0.13. Anything smaller
  stops reading as an eye at gameplay distance and the character goes dead.
  This was the single biggest fix between v1 and v2 of every model.
- **Catchlights**: always **two**. A big one high and outboard (~0.36 of the eye
  width), a tiny one low and inboard (~0.17). One catchlight looks like a doll's
  eye; two look alive.
- **Iris** (optional, hero characters): a soft coloured pool in the lower eye,
  gradient stopping at 0.95 of the eye radius so **an ink rim always survives**.
  A flooded eye loses its pupil and looks eerie rather than sweet.
- **Blush**: always present. `soft` (airbrushed gradient) for kids and bears,
  `disc` (solid, with a top highlight) for RiPika. Sits just below and outboard
  of the eyes.
- **Mouth**: stroked, round caps, line width ~2.6% of the canvas. `cat` (the "w"
  mouth) for mice and small creatures; `smile` for people and bears; `grin`
  (with two small **rounded** teeth) for mischief.
- **Muzzled animals** (bears, pups, corgis) wear a **second, smaller patch on
  the muzzle** carrying only the mouth, while the eyes stay on the head patch.
  A muzzle patch is a child of the muzzle mesh, so it already inherits the
  muzzle's squash — applying that scale again sinks it inside the snout and the
  smile vanishes.

### Expressions

`paintExpressions()` returns the full set in one call:
`neutral | blink | happy | surprised | sad`. Callers keep the record and swap
`material.map`. **That is the entire expression system** — nothing else in the
game animates a face.

### A face on a worn object goes in that object's own UV map

Everything above is about a face on a **head**, where a transparent patch worn
over the skull is right: the skull is the thing the face belongs to, and the
patch is what lets the eyes be bigger than the geometry allows.

A face painted on something the child *wears* — the critter hoods, and anything
like them — is a different problem, and the decal patch is the wrong answer to
it. **Bake the face into the wearing surface's own UV map instead**
(`paintFaceOnFill`, and `hoodShellGeometry`'s face window as the reference
implementation): paint the object's base colour as the texture's background
fill, then the face on top of it. One surface, one texture.

This is not a preference. Both critter hoods' faces were **invisible in the game
for a fortnight** and no check noticed. The patch mesh was wound the opposite
way round from the shell under it, so its normals pointed at the wearer's skull
and `MeshToonMaterial`'s `FrontSide` culled it outright — and the obvious fix,
floating it further out, could never have worked. A second surface has to be
kept in step with the first by hand, and every property of it is a way to get
that wrong: winding, stand-off distance, and whatever relief the base mesh adds
after you sampled it. There is nothing to keep in step if there is only one
surface.

Three things it costs, all cheap:

- the surface needs real UVs, and a UV that runs with azimuth **cannot close** —
  split the seam column the way `SphereGeometry` does, or one quad interpolates
  across the whole texture and smears the face round the back;
- weld the split seam's normals, or the toon ramp and the outline both draw a
  line down it;
- leave a border of plain base colour round the face (`FACE_FILL_INSET`), wide
  enough to survive mip-mapping. Everything outside the face window clamps to
  it, which is what makes the rest of the object come out the right flat colour
  from the same one texture.

Make it **opt-in** per object: something with no face keeps its flat-colour
material and its exact geometry, and pays nothing.

`npm run check:hood-face` holds this in place. It casts a ray in from outside at
each painted feature and checks what the camera would actually hit — which an
inside-out surface fails, and which measuring where the vertices *are* does not.

---

## 4. Proportions — where "cute" actually comes from

Measured consistently as **skull height ÷ total height** — the bare head, not
counting ears, horns or hair. Ratios below are after the **cartoon pass of 26
July 2026**, when the family asked for heads about double the size.

| Character | Head scale-up | Skull as % of total height | Total height |
| --- | --- | --- | --- |
| Player kid | ×1.5 | 45% → **59%** | 1.86 m → **2.12 m** |
| Mini | ×1.3 | 65% → **67%** | 0.56 m → **0.72 m** |
| RiPika | ×1.32 | 49% → **55%** | 1.24 m → **1.46 m** |
| Biscuit | ×1.32 | 59% → **65%** | 0.96 m → **1.15 m** |

Three things about that table are load-bearing:

- **"Double" means ×1.5 linear, not ×2.** A head scaled 1.5× covers 2.25× the
  screen area, and *area* is what the eye reads as "twice as big". A literal
  doubling of the kid's skull makes her 2.5 m tall and she stops fitting under
  her own shopping centre.
- **The creatures got less than the kid, on purpose.** A mini that is already
  two-thirds skull has no room to double; past about 70% the body stops being a
  body and the creature reads as a balloon with feet. Scale each character to a
  *target ratio*, never by a global multiplier.
- **The body shortens when the head grows.** The kid lost 0.08 m of torso and
  0.06 m of leg. A big head on a full-length body reads as wrong; a big head on
  a stumpy body reads as a toy. Nothing else changed about her.

Every model exposes the scale-up as a single module constant called `HEAD`, and
every number inside the head group is written `x * HEAD`. Retuning a character's
head is a one-line change, and the painted face patch — sized from `skullR` —
comes along for free.

### Heads and the isometric camera

The camera looks down at 38°. Past about 55% skull, an upright head presents the
player with the top of a hairstyle and no face at all. Two fixes, and which one
you use depends on whether the character has hair:

- **Hair (the kid):** tip the whole head back ~10° (`HEAD_TILT`) inside a
  `crown` group nested in `head`, so the animator can still rotate `head` on top
  of it. Moving the face patch up instead just slides it under the fringe.
- **No hair (RiPika, Biscuit, the mini):** raise the face patch on the skull with
  the existing `tilt` option on `createFacePatch`. Cheaper, and the patch keeps
  the skull's curvature so the eyes still wrap correctly.

Rules that matter more than the numbers:

- **Head wider than the torso.** If the body is as wide as the head the
  character reads as a lump.
- **Limbs short and fat.** Thin limbs are never cute. Minimum limb radius ~0.06
  on a 1 m creature.
- **Feet oversized.** Big round shoes/paws read as "toy" from the iso camera.
- **Eyes set low and wide** on the skull. Low = baby. Wide = friendly.
- **Nothing is plumb.** Trunks lean a few degrees, ears tilt, tails cant. A
  perfectly symmetrical upright object looks like a placeholder.
- **Squash every sphere.** Uniform spheres look like beach balls; a sphere
  squashed 10–25% on one axis looks sewn and stuffed. Use `blob()`.
- **Break the silhouette.** Every head gets one asymmetric feature — a cowlick,
  a tuft, a bunch — so it is not a perfect circle in outline.

---

## 5. Colour

`src/core/palette.ts` (`PALETTE`) is the world's colour bible and takes
precedence. `art/style/artPalette.ts` (`ART`) **extends** it with character and
prop colours. Never introduce a colour outside these two files, and never
redefine something the world already names — a second definition of "pink stone"
is how a park ends up with two slightly different pinks.

Test for a new colour: *would it look right on a plastic toy?* Bright and
saturated, but softened towards cream rather than white. Never neon. Never
washed out. Never black.

### Markings

Belly patches, spots and blazes are separate meshes laid on the surface. Two
traps, both hit during this run:

1. A patch must **protrude past the body surface**. If its front sits inside the
   body, only the parts that happen to poke through show, and the intersection
   curve reads as a jagged starburst.
2. On an ellipsoid, place it with `stickOnEllipsoid()` (in `balloons.ts`), not by
   eye — `Object3D.lookAt` uses world space and will aim your spot at the floor.

---

### Effects

Effects live in `src/art/effects/` and are the **one** place `MeshBasicMaterial`
is allowed on something you can see through. The rainbow hop ring
(`rainbowRing.ts`) is the reference implementation, and the rules it establishes
apply to every splash, confetti burst and sparkle that follows:

- **Pigment, not light.** Normal blending, never additive. Additive was tried on
  the hop ring first and it blew out to a flat white halo the instant it crossed
  the pale sand path — the rainbow only survived over grass. In a park made of
  painted things, an effect is paint.
- **Colour ramps go in the vertex colours**, baked once into a shared geometry.
  No custom shaders: a shader is one more thing that has to be kept in step with
  the park's lighting, and a gradient is free as an attribute.
- **A fixed pool, allocated at construction.** Never `new` a mesh per trigger.
  A six-year-old will hold the jump button down.
- **Fade on a curve, hold at the start.** A linear fade reads as the effect
  being switched off rather than dissipating.
- Effects are `decal()` — they cast no shadow and catch none — with
  `depthWrite: false` and a `renderOrder` above the world.
- Rainbow colours come from `ART.rainbow`. Six bands, all pulled well towards
  cream. Six is as many as survives being forty pixels wide on a phone.

---

## 6. Lighting the art is authored under

Copied from `src/core/Engine.ts` so a sample that looks great in the gallery
looks the same in the game:

- `NeutralToneMapping`, exposure 1. **Not ACES** — ACES desaturates bright
  colours towards white, exactly wrong for a park made of sweets.
- `VSMShadowMap`. Genuinely soft edges, which suits chunky rounded geometry far
  better than hard PCF.
- Hemisphere key (sky `ambientDay`, ground `grass`) + a warm directional sun +
  a cool opposite fill. The ramp handles shape; the fill handles colour
  temperature on the shadow side.

---

## 7. Contract with builders

**Builder-made and Artist-made assets must be interchangeable.** These are the
exact conventions. Full list in `ASSET_MANIFEST.md`; this is the load-bearing
subset.

Every asset is a **factory function returning a fresh `THREE.Group`**, wrapped in
an `AssetHandle` (`art/style/asset.ts`):

```ts
export interface AssetHandle {
  readonly root: Group;
  /** Total height in metres — the name label goes at `height + 0.42`. */
  readonly height: number;
  update?(dt: number, elapsed: number): void;
  dispose?(): void;
}

export function createThing(options?: ThingOptions): AssetHandle;
```

| Rule | Detail |
| --- | --- |
| **Units** | 1 unit = 1 metre. The player kid is **2.12 m** (`KID_HEIGHT`), **2.97 m** in the tallest hair and hat (`TALLEST_CHILD_HEIGHT`) — both in `src/art/models/kid.ts`. **Import them; never type them** (see §4, and the note in `ASSET_MANIFEST.md`). |
| **Origin** | At the **feet / base**, centred on X and Z. `root.position.y = groundHeight` must seat it with no fudge factor. Balloons are the exception: their origin is the **bottom of the string**, i.e. the hand-hold point, so `kid.holdAnchor.add(balloon.root)` needs no offset. |
| **Facing** | Forward is **+Z**. `root.rotation.y = 0` faces the camera in the default view. Rotate the root only. |
| **Scale** | Leave `root.scale` at 1 — it is reserved for gameplay squash-and-stretch. Bake size into geometry. |
| **`height`** | Measure to the **actual top**, including ears and hats. RiPika's is 1.24 (ear tips), not 1.06 (skull). Labels crop otherwise. |
| **Shadows** | Solid meshes: `solid(mesh)` (casts + receives). Decals, catchlights, glows, strings: `decal(mesh)` (neither). |
| **Naming** | `root.name` = the asset key: `'ripika'`, `'balloon.corgi'`, `'prop.lollipopTree'`. Parts an animator needs are exposed as typed fields, never looked up by string. |
| **Colour** | Only from `PALETTE` or `ART`. No inline hex in model files. |
| **Randomness** | Seeded `Rng` from `src/core/mathUtils.ts`. **Never `Math.random()`** in a builder — the park must look identical on reload. |
| **Textures** | Canvas-drawn only, cached by key. Budget: face patches 512², decals 256², tiling maps 512², under 40 distinct canvas textures game-wide. Flat colours are material colours, not maps. |
| **Import boundary** | `art/style/bridge.ts` is the **only** file that reaches into `src/`. Everything else imports from it. Relocating `art/style/` → `src/art/` is a one-line change in that one file. |

### Creatures additionally implement

```ts
interface CreatureHandle extends AssetHandle {
  readonly body: Group;   // bob / squash target — everything above ground lives here
  readonly head: Group;   // look-at target; rotating it must not move the body
  readonly limbs: CreatureLimbs | null;
  setExpression(name: Expression): void;
  setWalkPhase(phase01: number, speed01: number): void;
}
```

`setWalkPhase` should call the shared `applyWalk()` so the parade looks like one
family of toys rather than a pile of separately-animated assets. **Assets never
contain follow or AI logic** — the parade system (build step 5) drives them.

### Anchors

Attachment points are empty `Group`s exposed on the handle, never magic offsets:
`hatAnchor` (crown), `holdAnchor` (carried item, in the right hand),
`backpackAnchor` (peeking head).

### Instancing

Trees, bushes and wall segments are the only high-count items and are authored
instancing-friendly: geometry and materials are module-level singletons
(`treeCanopyGeometry()`, `stoneBlockGeometry()`, …). Take those directly for an
`InstancedMesh` with per-instance colour, or call the factory for a one-off.
Never call a factory inside a render loop.

### Primitives vs. authored geometry (e.g. Blender)

Chunky primitive composition — spheres, cylinders, capsules squashed and
combined — is the **preferred** way to build a model, not merely the default:
it is cheap to iterate, trivially hits §1–§4, and needs nothing outside this
repo. Stay with it whenever it can reach the target shape.

It is not an absolute rule, though, and treating it as one is its own
failure mode. **Organic, continuous forms genuinely fight primitive
composition** — hair is the paradigm case: real hair reads as strands, waves
and mass, which a stack of capsules approximates badly, however long you
fight it. For that category, model in Blender instead (31 July 2026 ruling).

An authored asset gets **no exemption from anything else in this contract**.
It must still look like it came off this pipeline, not visited from another
game: chunky and rounded per §1, the four-band toon ramp or the §2 material
table (no realistic shading, no surface micro-detail), the house palette
only, outlines ink-tinted per §4's rules — never black, never photoreal. And
it is wrapped in the exact same `AssetHandle` factory function as everything
above: origin at the base, `height` to the true top, seeded randomness if
any is needed. The only thing that changed is where the vertices came from.

**A painted face on an authored surface follows §3's governing rule too:**
bake it into the surface's own UV mapping rather than a second mesh that has
to independently agree with the first's geometry (31 July 2026, after the
RiPika/Trilla hood faces went invisible when a hand-rolled second mesh was
wound the wrong way round — see CLAUDE.md). And it still has to look like
flat appliqué that could have been geometry, not a texture doing shading's
job — §3's rule on that is not relaxed just because the base mesh is
authored.

---

## 8. Quick checklist before you commit an asset

- [ ] Origin at the base, facing +Z, `root.scale` untouched
- [ ] `height` measured to the true top, ears and all — and **re-measured** if
      you touched the head, or the name label will sit in the character's hair
- [ ] Head scale expressed as a single `HEAD` constant, ratio checked against §4
- [ ] Eyes at least 0.10 of the face patch, two catchlights, blush present
- [ ] Outlines on silhouette parts only, ink-tinted, never black
- [ ] Every sphere squashed; one asymmetric feature on the head
- [ ] Markings protrude past the surface
- [ ] No `Math.random()`, no inline hex, no `MeshBasicMaterial` on a solid
- [ ] Looked at it in `/art-samples.html` at gameplay distance, not just close up
