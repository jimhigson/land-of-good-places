# HANDOFF — the bridge, remodelled (3D Artist)

Branch `art/bridge-model`, worktree `.claude/worktrees/bridge-model`, off
`origin/main`.

## The brief (Jim, 2026-08-29)

> modelled stoneworks (not just textures) around the tops of the walls, a
> genuine arch-shaped tunnel with modelled archway masonry around its edge,
> 40% shorter than currently made (also will need to be steeper for this) and
> a more pronounced 'hump' shape to the bridge.

And, the same day, via the Overseer:

> it is ok for the gradient to be quite steep — we are building a cartoonish
> game here, not a real physics simulation — if it would not be plausible in
> real life I don't mind

So: exaggerate the form, not the interface. `ASSET_MANIFEST.md`'s contract and
the Engineer's dimensional contract still bind.

## Ownership split with the Engineer (`bridge-paving-clip`, issue #349, PR #352)

- **They own** span, rise, ramp gradient, deck width, arch opening dimensions,
  wall height, placement, and the clipping bug.
- **I own** the mesh: coping stones, arch masonry, the hump as sculpted form.

Their handoff (`HANDOFF-bridge-clipping-349.md` on `bridge-paving-clip`) is
**complete for the clipping fix but carries no dimensional contract yet** as of
the time I started. Numbers below are therefore *my measurement of `main`*, to
be reconciled when their contract lands.

## Numbers measured off `main` (not invented)

| | value | source |
| --- | --- | --- |
| `BRIDGE_RISE` | 4.03 m | `TRAIN_CLEARANCE_Y` 3.87 + `BRIDGE_DECK_DEPTH` 0.16 |
| `BRIDGE_RAMP_GRADIENT` | 0.268 | `ENTRANCE_RAMP` 0.75 / 2.8 |
| ideal ramp run, each side | 15.0 m | rise / gradient |
| `DECK_HALF_LENGTH` = `ARCH_SPAN_HALF` | 3.2 m | `FENCE_OFFSET` 2.0 + 1.2 |
| `ARCH_CLEAR_HALF` | 1.8 m | `TRACK_CLEARANCE` 1.3 + 0.5 |
| **total bridge length today** | **~36.5 m** | 2×3.2 + 2×15.0 |
| **40% shorter** | **~21.9 m** | Jim's ask |
| ⇒ ramp run each side | 7.76 m | (21.9 − 6.4) / 2 |
| ⇒ average ramp gradient | **0.52** | 4.03 / 7.76 |

`MAX_RAMP_GRADIENT` is 0.60, so **40% shorter fits under the existing cap**
with room to spare. Peak slope on the trapezoid profile is 1.333× average =
0.69, which costs 0.617 × 0.69 = 0.43 m of height per worst-case frame against
`BUILDING_STEP_UP`'s 0.62 ceiling — still a third of the ceiling spare, i.e.
the walkability argument in `bridges.ts`'s `HUMP_BLEND` note still holds.
**Jim's 40% is achievable; nothing here has to be compromised for it.**

## The arch: what "genuine" costs

The soffit today is a **flat crown** over |along| ≤ 1.8 with quarter-round
haunches — a tangent break, and it reads flat from the mouth. A genuine arch
dips at the crown edge, and the crown must rise by that dip to keep the train's
clearance, since `soffitCrownY` sits *exactly* on `TRAIN_CLEARANCE_Y` today.

Costed three shapes (dip measured at |along| = `ARCH_CLEAR_HALF`):

| shape | rise/span | extra crown height |
| --- | --- | --- |
| semicircle, R = 3.2 | 0.50 | **+0.554 m** |
| three-centred, dip 0.35 | 0.38 | **+0.35 m** |
| three-centred, dip 0.10 | 0.26 | +0.10 m |

**Chosen: three-centred, dip 0.35 m.** Continuously curved (no flat segment,
no tangent break), visibly arched, and only 0.35 m of extra crown — which the
gradient budget above absorbs (0.52 → 0.56 average). A semicircle would be the
storybook ideal but pushes the average gradient to 0.59, flush against
`MAX_RAMP_GRADIENT`, for 0.2 m of extra crown; not worth spending the
Engineer's entire margin on.

Derivation, crown radius `R1` and haunch radius `R2`, tangent-continuous:

```
R1  = (ARCH_CLEAR_HALF² + d²) / (2d)          = 4.804   (d = 0.35)
φ1  = asin(ARCH_CLEAR_HALF / R1)              = 22.0°
R2  = (ARCH_SPAN_HALF − ARCH_CLEAR_HALF) / (1 − sin φ1) = 2.239
springing = soffitCrownY − d − R2·cos φ1      = soffitCrownY − 2.426
```

The `deck` marker mesh the invariants measure moves down to `soffitCrownY − d`
— the arch's real binding point — so the clearance check stays honest.

## The pipeline route

Followed the **cart/hotel GLB route**, not a second one:
`art/blend/bridge_stones_build.py` → `art/blend/bridgeStones.blend` →
`art/blend/bridge_stones_export.py` → `src/art/assets/bridgeStones.glb` →
`npm run pack:bridge-stones` → `src/art/assets/bridgeStonesGlb.ts`.

**Why a kit of three stones and not a whole bridge model:** the bridge is
per-crossing parametric — variable span, variable ramp lengths, and it follows
the drawn path's own curve through `SpineFrame`. A single rigid `.glb` cannot
be that. So Blender authors the *repeating units* — one coping block, one
voussoir, one keystone — and `bridges.ts` bakes many transformed copies of each
authored geometry into one `BufferGeometry` per bridge (one draw call, no
per-stone `Mesh`).

Placing each stone individually through the frame, rather than one rigid ring,
is deliberate: on a curved spine a rigid ring would part company with the
swept spandrel exactly the way the old `deckMesh` box did (Jim's "there's still
a big hole in the mesh"). Each stone also stands **proud** of the spandrel
face, so it is an appliqué on solid stone — a placement error can never open
daylight.

`src/art/models/bridgeStones.ts` is the **single owner** of the kit's numbers;
the Blender script reads them back out of it with `ts_const`, exactly as
`hotel_build.py` reads `kid.ts`.

## Status

- [x] Blender MCP confirmed live (default scene: Cube/Camera/Light, untouched)
- [ ] kit modelled + rendered
- [ ] arch curve + rings + coping wired into `bridges.ts`
- [ ] `ASSET_MANIFEST.md` entry, PR

## Do not touch

`Untitled.blend` in the repo root is Jim's.
