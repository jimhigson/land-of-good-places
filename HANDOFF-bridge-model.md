# HANDOFF — the bridge, remodelled (3D Artist)

Branch `art/bridge-model`, worktree `.claude/worktrees/bridge-model`, off
`origin/main`. Paired with the Engineer on `bridge-paving-clip` (#349, PR #352).

## The brief (Jim, 2026-08-29)

> modelled stoneworks (not just textures) around the tops of the walls, a
> genuine arch-shaped tunnel with modelled archway masonry around its edge,
> 40% shorter than currently made (also will need to be steeper for this) and
> a more pronounced 'hump' shape to the bridge.

Plus, the same day: *"it is ok for the gradient to be quite steep — we are
building a cartoonish game here, not a real physics simulation."* Plausibility
is waived; playability is not.

Acceptance test, his words: **"there should be just a bridge with nothing
clipping inside it as part of the park scenery."**

## Status: complete, PR raised, not merged

- [x] kit modelled in Blender, rendered, judged
- [x] shipped through the existing GLB pipeline
- [x] genuine three-centred arch + modelled ring + coping + imposts + coursing
- [x] parapet arc (the pronounced hump)
- [x] `ASSET_MANIFEST.md` entry
- [x] procgen invariant, broken deliberately and watched go red
- [x] `npm run build` exit 0, `npx tsc --noEmit` exit 0, `npm run test:procgen`
      448 passed / 14 files

## ⚠️ THREE THINGS THAT ARE NOT MINE TO CLOSE

**1. The silhouette is a triangle, not a hump — and the lever is the road's.**
With `HUMP_BLEND` trimmed to 0.15 for sprint safety, the ramps are very nearly
straight lines, so the bridge's outline is a pyramid with a domed top. My
`PARAPET_ARC_RISE` of 0.45 m is real curvature but it is 0.45 m against a
4.24 m rise: it is a bow, not a hump. **If Jim looks at this and says it still
is not humped enough, the answer is the road's blend, not more parapet arc** —
see point 2 for why I cannot simply raise mine. The Overseer records that the
0.15 trim is provisional pending a fix to the underlying walk-physics defect;
when that lands, the blend goes back up and the silhouette follows for free.

**2. The parapet arc is capped by an absolute GAME_DESIGN rule, not by taste.**
0.45 m puts the coping's top 1.37 m over the road at the crown. At the park's
45° camera a sight line grazing the near parapet has fallen below the road by
the time it reaches a child, so she is not occluded at all — I checked the
geometry, it is in `PARAPET_ARC_RISE`'s own note. Going much past this starts
eating her from the game's own view, and *"a small bridge does not obscure a
player walking on it"* is absolute. Do not raise it without deciding that rule
is being traded.

**3. The arch's dip spends the Engineer's collision margin.** A curved crown
must rise by its own dip, because clearance is measured where the arch is
lowest over the track. That is deck height, and deck height on a 40%-shorter
bridge is ramp slope. `ARCH_CROWN_DIP` is deliberately **one tunable** with a
costed table beside it in `bridgeStonework.ts`:

| shape | arch rise/span | deck rise | peak slope | % of fall-through ceiling |
| --- | --- | --- | --- | --- |
| flat crown (before) | — | 4.060 | 0.693 | 69% |
| dip 0.10 | 0.26 | 4.160 | 0.710 | 71% |
| **dip 0.18 (shipped)** | **0.30** | **4.240** | **0.723** | **72%** |
| dip 0.35 | 0.38 | 4.410 | 0.752 | 75% |
| semicircle | 0.50 | 4.614 | 0.787 | 78% |

79% is the figure real-browser QA has watched a running child fall through at.
**If the walk-physics fix buys margin back, raise the dip and the arch gets
rounder for free.** Re-run `npm run blend:bridge-stones` after changing it —
the authored voussoir is cut for the haunch radius that number decides, and
`bridges.ts` throws at module load if the two stop agreeing.

## What was built

**The kit** (`art/blend/bridge_stones_build.py` → `bridgeStones.blend` →
`bridge_stones_export.py` → `src/art/assets/bridgeStones.glb`, 9.2 KB →
`npm run pack:bridge-stones`). Three stones: `coping`, `voussoir`, `keystone`.
Same route as the kid, cart, duck bar and hotel — no second pipeline.

**Why a kit, not a bridge model.** A bridge here is solved per crossing —
variable span, two variable ramps, a crown solved against the terrain — and it
follows the drawn path's own curve through `SpineFrame`. No rigid `.glb` can be
that. `bridgeStonework.ts` bakes many transformed copies of each authored
geometry into one `BufferGeometry` per bridge: authored shape, one draw call,
and the sweep still follows the curve.

**Every stone is placed individually through the frame, and stands proud of the
face it decorates.** Both deliberate. A rigid ring on a curving spine parts
company with the swept spandrel exactly the way the old `deckMesh` box did
(*"there's still a big hole in the mesh"*), and a stone standing proud of solid
stone can be millimetres out without ever opening daylight.

**`src/art/models/bridgeStones.ts` owns every dimension**; the Blender script
reads them back with `ts_const`, as `hotel_build.py` reads `kid.ts`. One
definition, not two agreeing by comment.

**The arch** is three-centred — two tangent-continuous circular arcs, no flat
segment, no tangent break. `bridgeStonework.ts`'s `archCurve` is the single
owner: `bridges.ts` asks it where the soffit is, and it asks itself where each
voussoir goes, so the stone a child sees and the hole a train goes through
cannot be two different arches.

**The parapet top line** has one owner too, `parapetTopFor` in `bridges.ts` —
the shell draws it, the collision walls stop at it, the coping sits on it. A
collider left at the un-arced height would have let a child climb the drawn
stone and step over the side.

**The flank is coursed** — levelled bands, alternate ones recessed 6 cm.
Recessed *inward* only: `halfAcross` is the width the footprint search proved
clear, so the wall may get thinner than it, never fatter. The outer wall still
runs half a metre under the terrain, which is what stops a bridge floating over
its own ground, and that stays.

## Renders (`art/renders/`)

`bridge-iso` (the game's 45°), `bridge-arch` (ring + keystone square on),
`bridge-flank` (**a child's eye at the ramp foot — the shot the coursing is
for**), `bridge-coping` (the run over the hump), `bridge-silhouette`.

Rebuild them with
`blender --background --factory-startup --python art/blend/bridge_stones_render.py`.
The preview assembles a whole bridge from the kit using the *same* arch and
hump maths the game does; if the two ever disagree, the render is the one that
is wrong.

## Two preview-only bugs worth not re-finding

- A strip that **skips** a clamped-away sample bridges the gap to the next one.
  It drew flat bars straight across the tunnel mouth. `bridges.ts` is immune by
  construction — every ring keeps the same course count and emits degenerate
  pairs instead.
- A `SOLIDIFY` offset follows the strip's own winding, so half the courses were
  pushed *into* the wall and vanished. Straddle the face instead.

## The invariant

`nothingHangsIntoTheTunnel` in `test/procgen/invariants.ts`. Fires rays **up**
from the rail, across the train's swept width, and looks at what it hits first
— the real built stone, not the invisible `deck` marker, which is a claim
`bridges.ts` makes about its own arch. Broken deliberately it goes red on all
five seeds:

```
bridge-172.0 leaves only 3.87 m of air over the rail against the 3.90 m the
train and its riders sweep to — lowest built stone is shell at (-19.8, 35.3)
```

## Do not touch

`Untitled.blend` in the repo root is Jim's. The live Blender instance is
shared — every script here runs `--background --factory-startup` so it can
never reach into it.
