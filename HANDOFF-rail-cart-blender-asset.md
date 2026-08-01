# Handoff: Rail Race cart → Blender-authored `.glb` asset

**Status: done, built (`npm run build` exits 0), not yet PR'd — do that next if
you're picking this up.**

## The ask

Jim, after a live playtest (1 August): "I don't see real mine cars with
wheels, just rectangles with headlights — check this pls, the wheels should be
on the rails and rotate." Root cause (found by the Overseer, reading the live
scene): the procedural tub (`RoundedBoxGeometry(1.15, 0.6, 1.7, ...)`) was
both wider and reached lower than the wheel positions, so the tub's own walls
and floor covered the wheels almost entirely. This had already happened
**twice** in hand-tuned procedural TypeScript. Jim's explicit direction: model
a real asset in Blender, following the kid's `.glb` pipeline
(`ART-AGENT-NOTES.md` §6a) — not another round of hand-picked numbers.

## What shipped

- `art/blend/cart.blend` — the authoring source, 12 named objects (see
  below), built with `bmesh` primitives + real (non-modifier) bevels for the
  chunky-rounded look.
- `art/blend/cart_export.py` — headless export, mirrors `kid_roundtrip.py`'s
  export step. No import/bootstrap step, unlike the kid: the cart has no
  procedural Stage A, `cart.blend` is the authoring source from day one.
- `scripts/pack-cart-asset.mts` + `scripts/lib/pack-glb-asset.mts` — the
  `.glb` → base64-module step, factored out of `pack-kid-asset.mts` since this
  is the **second** asset through the pipeline (verified the refactor is
  byte-identical for kid's own output before trusting it for cart's).
- `src/art/assets/cart.glb`, `src/art/assets/cartGlb.ts` — the packed asset.
  52 KB raw / 8.4 KB gzipped, comfortably inside the 150 KB/asset budget.
- `src/art/models/cartAsset.ts` — mirrors `kidAsset.ts`: `cartAssetPart`,
  `cartAssetMesh`, `cartAssetGeometry`, `cartAssetPartNames`.
- `src/world/railRace/cart.ts` — rewritten to build every part from the asset
  instead of primitives. Public contract unchanged: `createCart`,
  `CartHandle`, `SEAT_HEIGHT` all still there, so `RailRace.ts` needed **no**
  changes at all.
- `scripts/check-cart-shape.mts`, wired into `npm run build`.
- npm scripts: `pack:cart`, `blend:cart` (mirrors `blend:kid`'s shape).

## The parts, and the numbers they were modelled against

`CART_PARTS` in `cart.ts`: `tub`, `nose`, `seat-back`, `seat-base`,
`pet-seat`, `pet-back`, `wheel-fl/fr/bl/br` (one shared mesh, 4 nodes),
`lamp-l/lamp-r` (one shared mesh, 2 nodes). All at the cart's own
pre-`RIDE_SCALE` local metres, same convention the procedural version used.

Derived the target proportions from the **dodgem car's own** wheel/tub
relationship (`src/minigames/dodgems/car.ts`) — not copied numbers, the same
ratio applied to this cart's own reference numbers:

- `WHEEL_RADIUS = 0.16`, gauge half = `0.31` (= `RAIL_GAUGE / RIDE_SCALE / 2`,
  algebraically `0.62 / 2` regardless of `RIDE_SCALE`, since `RAIL_GAUGE :=
  0.62 * RIDE_SCALE` in `track.ts` — safe to bake).
- Tub: width **0.80 m** (was 1.15), height 0.56 m, bottom at **y = 0.16 m**
  (exactly the wheel's own axle height — exposes the bottom half of every
  wheel, the same relationship the dodgem's tub has to its own wheel).
- `SEAT_HEIGHT = 0.47` unchanged, and re-verified: the `seat-base` node's own
  top surface measures exactly 0.47 m (`check:cart-shape` asserts this against
  the real geometry, not the number that was supposed to produce it).

## The axis bug that ate most of the session — read this before touching Blender again

Blender is **Z-up, Y-forward**; the game is **Y-up, Z-forward**.
`export_yup=True` converts glTF(x,y,z) = Blender(x, z, −y). My first pass
authored positions using Blender's raw (x, y, z) as if `y` meant "height" —
it doesn't, in Blender's own convention. The result: the tub's 1.7 m length
came out along the exported **Y** (height) axis and its 0.56 m height came out
along **Z** (depth) — a cart that would have rendered impossibly tall and
short. Caught by reading the actual exported node positions back with the
game's own `readGlbParts` (not by eyeballing Blender's viewport) and comparing
against what was intended.

**Fix, and the thing to reuse next time:** a small `game_to_blender(x, height,
forward) -> (x, -forward, height)` helper in the authoring script, and box
dimensions built as `(width, depth, height)` along Blender's own
`(X, Y, Z)`. Verified afterward by reading the `.glb` back with
`readGlbParts` and checking real local extents and node positions — not by
trusting the Blender viewport or the export log.

## A second real bug, found by the same discipline: `dispose()`

The original procedural cart built its own private geometry per `createCart`
call, so its `dispose()` freeing every mesh's geometry outright was correct.
The asset changes that: all four carts (and any future one) now share the
**same** wheel/lamp/tub buffers (`cartAsset.ts`'s module-level cache,
`markShared`). The old hand-rolled dispose loop didn't check `isShared`, so
disposing one cart would have freed geometry the other three (and the next
race's carts) still needed — invisible until something re-rendered, per
`materials.ts`'s own warning about exactly this failure shape. Fixed by
switching to the existing `disposeTree()` helper, which already respects
`markShared`. **Could not be proven by reading buffer contents back in
Node** — `BufferGeometry.dispose()` only fires an event a live `WebGLRenderer`
listens for; the JS-side attribute arrays are untouched either way. What *is*
checked headlessly, and is the actual precondition the fix depends on: every
cart-asset geometry is asserted `isShared` in `check:cart-shape`.

## Verification — what was and wasn't checked, and how

**Checked, and how:**

1. **Geometry, read back through the game's own `readGlbParts`** (not trusted
   from the Blender export log) — confirmed real local extents, node
   positions and quaternions for every part after the axis fix.
2. **Ray-cast from outside** (`ART-AGENT-NOTES.md` §6, the exact technique
   that caught the invisible hood faces): a ray at each wheel's own axle
   height, from outside the cart, hits that wheel first, not the tub. All 4
   pass. Also cast the same ray against the checked-out `origin/main` cart
   (not committed, was a throwaway `cart-old-copy.ts` + script, both deleted
   after) — **it hits the tub on all four wheels**, with only 2 cm of
   vertical clearance, against the new cart's 13.6 cm. This is the
   "compare against the previous rendering, not against your own new code"
   check §6 insists on — not a tautology.
3. **`npm run build` exits 0** — every existing check plus the new
   `check:cart-shape`, `tsc --noEmit`, `vite build`. Checked the actual exit
   code, not piped through `head`/`tail`.
4. **`npm run pack:kid`'s refactor** verified byte-identical before trusting
   the shared helper for cart's own script.

**Not checked, and why:**

- **No browser.** Did not have the shared chrome-devtools Chrome profile and
  wasn't told to take it (CLAUDE.md). Everything above is Node-side
  measurement against the real built meshes, not a screenshot. **This still
  needs a live look** — ray-casts prove the geometry is theoretically visible
  from a side angle, not that the toon shading/lighting reads well, or that
  the bevel/rounding looks right at gameplay distance. Whoever owns the
  browser next should load `/rail-race`, look at a passing cart from the
  side, and confirm it actually reads as "wheels."
- **No `test:procgen`.** `vitest` isn't installed anywhere reachable in this
  environment (neither this worktree's `node_modules`, which doesn't exist,
  nor the shared checkout's) — a pre-existing environment gap, not something
  this change caused. Irrelevant to this task anyway: nothing here touches
  procgen.

## Coordination note for whoever is adding real headlamp lights

A separate task (per the brief) is adding real light sources to the cart's
headlamps. The lamp *mesh* now lives in the asset (`lamp-l`/`lamp-r` nodes,
positioned on the nose's face) — the emissive material/glow behaviour is
still assigned in `cart.ts`, same as before, so that work should only need to
touch `cart.ts`, not the asset. If it needs the lamp mesh repositioned, that's
a Blender + `blend:cart` change, not a `cart.ts` number.

## Next steps

1. Open the PR (`gh pr create`), stating plainly what's verified above and
   what still needs a browser look.
2. Someone with the shared Chrome profile should actually look at a cart from
   the side.
