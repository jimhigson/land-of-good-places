# Artist progress

## Done
- [x] Read GAME_DESIGN.md, palette.ts, textures.ts, Engine.ts, CharacterModel.ts
- [x] ASSET_MANIFEST.md drafted and sent to the Architect (approved, answers folded in)
- [x] art/style/bridge.ts — the single import boundary into src/
- [x] art/style/artPalette.ts — character/prop colours extending PALETTE
- [x] art/style/materials.ts — toon ramp, toonMaterial, ink outlines
- [x] art/style/faces.ts — canvas face patches + expression sets
- [x] art/style/shapes.ts — heart, star
- [x] art/style/asset.ts — AssetHandle/CreatureHandle contract, blob/stub, walk cycle
- [x] art/models/ripika.ts
- [x] art/models/biscuit.ts
- [x] art/models/kid.ts
- [x] art/models/balloons.ts (dalmatian, corgi, chicken)
- [x] art/models/mini.ts
- [x] art/models/props.ts (lollipop tree, pink wall, wood wall)
- [x] art/samples/main.ts + art-samples.html
- [x] First screenshots (v1) — sent to the client
- [x] Self-critique iteration pass (v2) — see "What changed" below
- [x] Full render set in art/renders/
- [x] ART_DIRECTION.md (style bible + contract with builders)
- [x] art/integration/TOON_SWAP.md (prepared, NOT applied to src/)

## What the iteration pass changed
1. **Eyes were far too small on every character** — the single biggest miss.
   Raised the shared default to `eyeW 0.118 / eyeH 0.152` of the face patch and
   bumped every model. This is now a documented hard floor (>= 0.10).
2. **Eleri's hair swallowed her face.** Cut the hair shell from 0.56pi to 0.46pi
   of theta and thinned the fringe, so there is forehead to put big eyes on.
3. **Biscuit had no mouth.** The muzzle patch was double-scaled (it already
   inherits the muzzle mesh's squash) and had sunk inside the snout.
4. **RiPika's ears looked like flat paper** and its tail was invisible behind the
   body. Ears rebuilt from tapered cylinders with rounded cocoa caps; tail
   re-mounted on the hip and canted so the flash reads in silhouette.
5. **The lollipop tree read as three separate balloons**, and the blossom variant
   was a solid pink ball. Canopy is now one colour with low overlapping puffs;
   blossom/fruit are scattered dots on green.
6. **The Mini's iris flooded its eyes** (no pupil, eerie) and its belly patch was
   buried in the torso, showing as a jagged starburst.
7. **Gallery staging**: tightened framing, spread the rows in depth so the iso
   projection fills the frame, and replaced the flat grey-reading floor with a
   cream-to-mint radial wash.

## Follow-ups (not this run)
- RiPika's tail reads as a chunky flash but the amber tip is still mostly
  occluded at the default sway angle; consider shortening the third slab.
- Pink wall finials float ~0.06 above the coping (also logged in TOON_SWAP.md).
- Chicken-looter's beak is small enough to read as a nose at gameplay distance.
- Corgi goggle lenses sit behind the strap and never show; move them forward.
- Balloon bodies pick up a green cast from the showroom floor bounce — check
  them against real garden grass once integrated.
