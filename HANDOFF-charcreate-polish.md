# Handoff — character creation polish (`fix/charcreate-polish`)

Three jobs on the character-creation screen. Job 1 is done and committed.

## 1. Texture leak in the preview — DONE

**The answer to "shared or per-instance?": BOTH, in the same subtree.** This is
the load-bearing finding; it is why the fix could not just be "dispose
`material.map`".

Per-instance (safe to free, and the actual leak):
- `createFacePatch` (`art/style/faces.ts`) paints a **fresh set of five** 512²
  canvases per call via `paintExpressions`. The kid in the preview gets its own
  set on every rebuild. `material.map` only ever references **one** of the five,
  so even a naive "dispose `map` too" fix would have freed a fifth of the leak.
- `biscuit.ts`'s muzzle texture, `catBus.ts`'s face — one texture, always in a
  material slot, so the generic slot scan finds them.

Shared, and catastrophic to free (a cache owns them):
- `toonRamp()` in `materials.ts` — one `DataTexture` that is the `gradientMap`
  of **every toon material in the game**.
- `sharedFace.ts` — expression textures **and geometry**, cached per key. The
  preview's *pet* wears `sharedFacePatch('pet')`, so the old `disposeTree` was
  **already freeing that shared geometry on every tap** (pre-existing bug, now
  fixed by the same change).
- `facePaintOverlayTexture` cache (`faces.ts`), `core/textures.ts`'s `cached()`,
  `pets.ts`'s `puffSingingTexture`, `FloorArrows.ts`'s `arrowTexture`.

**Mechanism.** `materials.ts` now has an ownership marker on `userData`:
- `markShared(resource)` — applied at each cache's insertion point, so a new
  cache cannot forget it somewhere `disposeTree` was never considered.
- `ownTextures(material, textures)` — "owns these but is not pointing at them",
  used by `createFacePatch` for its five expressions.
- `disposeTree` now frees geometry (unless shared), scans each material's own
  properties for anything with `isTexture` (rather than a hand-written slot
  list, which is a list somebody will forget to extend), plus its owned set,
  skipping anything shared and de-duplicating within one walk.

**Deliberately NOT touched:** `world/building/parts.ts` has a second, duplicate
`disposeTree` that still ignores textures. Now that shared resources are marked
it would be safe to delete and re-export the `materials.ts` one, but the
building files are live on two other branches tonight — left alone, flagged in
the PR.

## 2. Preview camera follows what changed — IN PROGRESS

Design settled:
- `CharacterPreview.update(choice, focus)` where focus is
  `'all' | 'head' | 'face' | 'body' | 'pet'`.
- Framing is computed from a real `Box3` of the relevant subtree, not
  hand-tuned camera positions — that is what guarantees a tall hat cannot be
  cropped. Boxes are measured with `stage.rotation.y` temporarily zeroed so
  they are turntable-independent, then the centre is rotated back by the live
  turntable angle each frame so the camera tracks the swinging pet.
- Fit-a-box distance (much tighter than a bounding sphere):
  `distV = halfY / tan(halfFovV) + halfZ`, `distH = halfX / tan(halfFovH) +
  halfZ`, `dist = max(distV, distH) * margin`.
- Subtrees: `'head'` = `kid.head` (the hat is parented under it, so it is
  included automatically); `'face'` = the mesh named `facePatch`; `'pet'` = the
  pet root; `'body'` = the character box clipped to below the chin;
  `'all'` = the whole character.
- Smoothing: exponential damping toward the target, snap instead when
  `prefers-reduced-motion`. Focus is held ~2.4 s after the last change, then
  eases back to `'all'`.

Mapping from control to focus: hat/hair colour/hair style → `head`,
eye colour → `face`, clothes → `body`, pet → `pet`, skin/name → `all`.

## 3. Card still clips at the bottom at 2560x1600 — TODO

Measured why (1rem = 32.67px at that size, from the `clamp(20px, 0.62vw +
0.55vh + 8px, 38px)` root):
- Card is `min(58rem, 96vw)` = 1895px wide, so `.charcreate-controls` gets
  ~1300px, and `repeat(auto-fit, minmax(14rem, 1fr))` = 457px min yields only
  **2 columns**.
- 8 sections over 2 columns = 5 rows, and grid rows are as tall as their
  tallest member, so the hat section (8 hats, 2-wide, `4.625rem` rows ≈ 705px)
  inflates a whole row. Total ≈ 2620px of content into ~1075px of body.

Plan: (a) widen the card to `min(74rem, 96vw)`; (b) replace the grid with CSS
multi-column (`columns: 13rem`) + `break-inside: avoid` + `column-span: all` on
the name — multicol packs by height and does not couple sections into rows,
which is what "flow into more columns before growing taller" needs; (c) shave
`.charcreate-row` `min-height` 4.625rem → 4.25rem.
Predicted worst column at 2560x1600 ≈ 891px vs ~1075px available. 1920x1080 is
borderline; a 1280x800 laptop will still scroll, which is fine — that is where
the sticky preview earns its keep. **Sticky preview must not regress.**

## QA needed (no browser — build-verified only)
Everything visual. See the PR body.
