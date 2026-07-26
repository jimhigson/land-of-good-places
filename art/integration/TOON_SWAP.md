# Integration patch — toon swap + kid restyle + tree/wall swap

**STATUS: PREPARED, NOT APPLIED.** Nothing in `src/` has been touched by the
Artist. Apply only when the Architect gives the word and no other agent is in
`src/`.

This is deliberately one commit, because it is one visible change: the moment it
lands, the whole park stops looking like shaded primitives and starts looking
like painted toys.

Reserved files (no other agent may edit these until this lands):
`src/world/Scenery.ts`, `src/world/Fountain.ts`, `src/entities/CharacterModel.ts`.

---

## Step 0 — relocate the art system into `src/`

```
git mv art/style src/art/style
git mv art/models src/art/models
```

Then the **only** edit needed, in `src/art/style/bridge.ts` — three import
paths, because `bridge.ts` is the sole file that crosses the boundary:

```diff
-export { PALETTE, hexToCss, type PaletteKey } from '../../src/core/palette';
+export { PALETTE, hexToCss, type PaletteKey } from '../../core/palette';
 export {
   grassTexture,
   pathTexture,
   pinkStoneTexture,
   woodTexture,
   signTexture,
   nameLabelTexture,
   glowTexture,
-} from '../../src/core/textures';
-export { Rng, TAU, clamp, clamp01, lerp, smoothstep } from '../../src/core/mathUtils';
+} from '../../core/textures';
+export { Rng, TAU, clamp, clamp01, lerp, smoothstep } from '../../core/mathUtils';
```

And in `art/samples/main.ts` (the gallery stays at `art/`, importing from the new
canonical location — no duplicated style code):

```diff
-import { hexToCss, nameLabelTexture, PALETTE } from '../style/bridge';
-import { ART } from '../style/artPalette';
-import { toonMaterial } from '../style/materials';
-import type { AssetHandle, CreatureHandle } from '../style/asset';
-import { createRipika } from '../models/ripika';
-import { createBiscuit } from '../models/biscuit';
-import { createKid } from '../models/kid';
-import { createMini } from '../models/mini';
-import { createBalloon } from '../models/balloons';
-import { createLollipopTree, createPinkWall, createWoodWall } from '../models/props';
+import { hexToCss, nameLabelTexture, PALETTE } from '../../src/art/style/bridge';
+import { ART } from '../../src/art/style/artPalette';
+import { toonMaterial } from '../../src/art/style/materials';
+import type { AssetHandle, CreatureHandle } from '../../src/art/style/asset';
+import { createRipika } from '../../src/art/models/ripika';
+import { createBiscuit } from '../../src/art/models/biscuit';
+import { createKid } from '../../src/art/models/kid';
+import { createMini } from '../../src/art/models/mini';
+import { createBalloon } from '../../src/art/models/balloons';
+import { createLollipopTree, createPinkWall, createWoodWall } from '../../src/art/models/props';
```

`tsconfig.json` already has `"include": ["src", "vite.config.ts"]`, so the moved
files come under `npm run typecheck` automatically. They pass today under the
project's strict settings (verified with a temporary project config).

---

## Step 1 — `src/world/Scenery.ts`

### 1a. Import

```diff
 import {
   ...
-  MeshStandardMaterial,
   ...
 } from 'three';
+import { toonMaterial } from '../art/style/materials';
```

Keep `MeshStandardMaterial` in the import list **only if** something else in the
file still uses it after these edits; at the time of writing, nothing does.

### 1b. Foliage (line ~335)

The `roughness` argument becomes meaningless under toon shading. Keep the
signature so callers do not change; ignore the value.

```diff
-function foliageMaterial(roughness: number, flatShading = false): MeshStandardMaterial {
-  return new MeshStandardMaterial({
-    color: 0xffffff,
-    roughness,
-    metalness: 0,
-    flatShading,
-  });
-}
+/**
+ * Foliage is toon-shaded like every other toy object. `roughness` is retained
+ * in the signature for call-site compatibility and deliberately ignored — the
+ * toon ramp, not a roughness value, decides how leaves shade.
+ */
+function foliageMaterial(_roughness: number, flatShading = false): MeshToonMaterial {
+  const material = toonMaterial(0xffffff);
+  material.flatShading = flatShading;
+  return material;
+}
```

Add `MeshToonMaterial` to the `three` import.

### 1c. Wooden walls (line ~390)

```diff
-  const boardMaterial = new MeshStandardMaterial({
-    map: woodTexture(1, 1),
-    roughness: 0.9,
-    metalness: 0,
-  });
-  const postMaterial = new MeshStandardMaterial({
-    color: PALETTE.woodDark,
-    roughness: 0.9,
-    metalness: 0,
-  });
-  const capMaterial = new MeshStandardMaterial({
-    color: PALETTE.woodLight,
-    roughness: 0.7,
-    metalness: 0,
-  });
+  const boardMaterial = toonMaterial(0xffffff, { map: woodTexture(1, 1) });
+  const postMaterial = toonMaterial(PALETTE.woodDark);
+  const capMaterial = toonMaterial(PALETTE.woodLight);
```

### 1d. Pink stone walls (line ~470)

```diff
-  const wallMaterial = new MeshStandardMaterial({
-    map: pinkStoneTexture(1, 1),
-    roughness: 0.85,
-    metalness: 0,
-  });
-  const copingMaterial = new MeshStandardMaterial({
-    color: PALETTE.stonePinkLight,
-    roughness: 0.6,
-    metalness: 0,
-  });
+  const wallMaterial = toonMaterial(0xffffff, { map: pinkStoneTexture(1, 1) });
+  const copingMaterial = toonMaterial(PALETTE.stonePinkLight);
```

### 1e. Optional, same commit — ball finials on the pink wall runs

The art direction adds a ball finial + collar at the end of each wall run (see
`createPinkWall` in `art/models/props.ts`, and `art/renders/prop-pink-wall.png`).
It is the single detail that makes the wall look cared for rather than extruded.
Port it by adding, after the `coping` mesh is placed in the run loop, a
`SphereGeometry(0.19)` finial in `PALETTE.stonePink` at each end of the run,
seated so it **overlaps** the coping — see the known issue at the bottom of this
file.

---

## Step 2 — `src/world/Fountain.ts`

**Water stays `MeshStandardMaterial`.** It is on the ground/water/glass side of
the material rule: banding a transparent rippling surface looks broken, and the
`metalness: 0.3` specular is what sells it as water. Only the stonework changes.

```diff
-    const stoneMaterial = new MeshStandardMaterial({
-      map: pinkStoneTexture(6, 1),
-      roughness: 0.85,
-      metalness: 0,
-    });
-    const trimMaterial = new MeshStandardMaterial({
-      color: PALETTE.stonePinkLight,
-      roughness: 0.55,
-      metalness: 0,
-    });
+    const stoneMaterial = toonMaterial(0xffffff, { map: pinkStoneTexture(6, 1) });
+    const trimMaterial = toonMaterial(PALETTE.stonePinkLight);
```

And the basin floor (line ~85):

```diff
-      new MeshStandardMaterial({ color: PALETTE.stonePinkDark, roughness: 0.95 }),
+      toonMaterial(PALETTE.stonePinkDark),
```

Leave `this.waterMaterial` and `jetMaterial` exactly as they are. Note that
`updateJets()` casts to `MeshStandardMaterial` at line ~193 — that cast stays
valid because the jets are untouched.

Add `import { toonMaterial } from '../art/style/materials';`.

---

## Step 3 — `src/entities/CharacterModel.ts` → the restyled kid

The Player-facing API must not change. `CharacterModel` keeps its public
surface (`root`, `body`, `head`, `leftArm`, `rightArm`, `leftLeg`, `rightLeg`,
`eyes`, `height`, `setOutfitColour`, `setHairColour`) and becomes a thin adapter
over `createKid()`.

The one genuine behaviour change: **`eyes` no longer exists as geometry**,
because the face is painted. `Player` currently scales `eyes[].scale.y` to blink.
Replace that with the expression system.

```ts
// src/entities/CharacterModel.ts  (new body, ~40 lines instead of 234)
import { Group } from 'three';
import { createKid, type KidHandle, type KidOptions } from '../art/models/kid';
import type { Expression } from '../art/style/faces';

export interface CharacterColours {
  readonly skin: number;
  readonly hair: number;
  readonly outfit: number;
  readonly shoe: number;
}

export class CharacterModel {
  readonly root: Group;
  readonly body: Group;
  readonly head: Group;
  readonly leftArm: Group;
  readonly rightArm: Group;
  readonly leftLeg: Group;
  readonly rightLeg: Group;
  readonly height: number;

  /** Attachment points for hats, carried toys and backpack peekers. */
  readonly hatAnchor: Group;
  readonly holdAnchor: Group;
  readonly backpackAnchor: Group;

  private readonly kid: KidHandle;

  constructor(colours: CharacterColours, options: KidOptions = {}) {
    this.kid = createKid({ ...colours, ...options });
    this.root = this.kid.root;
    this.body = this.kid.body;
    this.head = this.kid.head;
    this.leftArm = this.kid.limbs!.leftArm;
    this.rightArm = this.kid.limbs!.rightArm;
    this.leftLeg = this.kid.limbs!.leftLeg;
    this.rightLeg = this.kid.limbs!.rightLeg;
    this.height = this.kid.height;              // still 1.86
    this.hatAnchor = this.kid.hatAnchor;
    this.holdAnchor = this.kid.holdAnchor;
    this.backpackAnchor = this.kid.backpackAnchor;
  }

  /** Blinking and moods are a texture swap now, not a geometry scale. */
  setExpression(name: Expression): void {
    this.kid.setExpression(name);
  }

  setSkinColour(c: number): void { this.kid.setSkinColour(c); }
  setHairColour(c: number): void { this.kid.setHairColour(c); }
  setOutfitColour(c: number): void { this.kid.setOutfitColour(c); }
  setShoeColour(c: number): void { this.kid.setShoeColour(c); }
}
```

### The one required change in `src/entities/Player.ts`

Find the blink code that scales `model.eyes` and replace it:

```diff
-    for (const eye of this.model.eyes) eye.scale.y = blinkScale;
+    this.model.setExpression(blinking ? 'blink' : 'neutral');
```

`Player` should call `setExpression` only on **transitions**, not every frame —
it swaps a texture and flips `needsUpdate`.

If `Player` also drives the limbs by hand, it can keep doing so (the pivots are
the same objects), or switch to `kid.setWalkPhase(phase, speed)` for the shared
house walk cycle. Either works; the second is preferred.

---

## Step 4 — trees

`Scenery.ts` grows its own trees today. The art direction's
`createLollipopTree()` is a drop-in for the "stack" variant and adds
`plain | blossom | fruit | tall`. Two rules it encodes that the current trees
do not:

1. **The canopy is one colour.** An earlier version gave the side puffs a
   lighter green and they read as bald patches.
2. **Blossom and fruit are scattered dots on a green canopy**, never a
   recoloured canopy — a solid pink ball stops reading as a tree.

Port either by calling the factory, or by applying rules 1 and 2 to the existing
generator. Prefer the factory: it is already instancing-friendly
(`treeCanopyGeometry()` / `treeTrunkGeometry()` are module-level singletons).

---

## Verification after applying

```bash
npm run typecheck          # must be clean
npm run build              # must be clean
npm run dev                # then open BOTH:
#   /                 — the game. Trees, walls and fountain should read as
#                       painted toys; the terrain and water must NOT band.
#   /art-samples.html — must still render identically to art/renders/gallery-wide.png
```

Specifically check, in the game:

- terrain and paths still smoothly shaded (they are `MeshStandardMaterial` —
  if the lawn has bands, something was swapped that should not have been);
- fountain water still transparent and specular;
- night: the toon ramp under low light must not crush foliage to a flat block —
  if it does, raise the first ramp band in `materials.ts`, do not darken it;
- the kid blinks, and blinking does not run every frame.

---

## Known issues to fix in this same commit

1. **Wall finial gap.** In `createPinkWall` the ball finial sits at `y = 1.42`
   while the coping tops out at `1.30`, leaving a visible gap between ball and
   collar (see `art/renders/prop-pink-wall.png`). Seat the finial at
   `y ≈ 1.36` and widen the collar so they overlap.
2. **`foliageMaterial` roughness parameter** is dead after the swap. Left in
   place to avoid touching call sites in the same commit; delete it in a
   follow-up once nothing passes it.
