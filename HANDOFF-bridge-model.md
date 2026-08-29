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

## Peer review of PR #360 — three blockers, all closed

**1. Double-arc merge hazard — was already fixed, and is now proved.** `d90c780`
deleted my arc and adopted #352's `parapetHeightFor` verbatim. Both branches
carry one `PARAPET_CROWN_LIFT = 0.45` and a byte-identical function. The merge
was *performed* in a scratch worktree, not argued: `bridges.ts` conflicts in one
hunk, both sides saying the same thing two ways, and the keep-both resolution the
review feared is a **compile error** (`TS2451: Cannot redeclare block-scoped
variable`), not a silent 2.10 m. Resolved: tsc exit 0, parapet 1.17 m + 0.20 m
coping = 1.37 m. Merged-tree procgen 452 passed / 1 failed, and that one is
#352's own pre-existing seed-11 detour blocker — confirmed failing identically on
`bridge-paving-clip` alone.

**2. Renders were of a different bridge.** The render script hand-copied
constants the build script has always read properly. `scripts/dump-bridge-
constants.mts` now imports the game's modules, evaluates them and prints JSON;
the Python reads it as a subprocess. `profileDrop` arrives as a sampled table and
is interpolated rather than reimplemented. The preview draws **36.71 m**, which is
what this branch builds — the 40% is #352's. Cameras scale with the bridge's own
length so the shots survive the merge.

**3. The lump is the paving, not the flank.** Correct, and my PR body overstated
it. The masonry flank is the two thin strips at the deck edges; the mound Jim
called "a pile of sand" is the path ribbon over the ramp. Coursing the flank
cannot fix that complaint. The fix is #352's shortening plus whatever the paving
itself needs. The coursing still earns its place for the child's-eye view at a
ramp foot, but it is not the answer to the lump.

**Triangles.** Clean `origin/main`: 1,138 tris / 3 draws per bridge. This branch:
10,770 / 5 — 9.5×, higher than the 8.4× reviewed because the coping fix raised
block count 70 → 98. Against #251's own 3,181,346 scene-graph triangles, four
bridges add 38,528 = **+1.2%**; draw calls +8, or +16 with the shadow pass, of
~540. Affordable: #251's overshoot is dominated by 2,224 meshes and 11,290
instances, not by bridges. The lever if ever needed is the stones' one-segment
chamfer, roughly 40% of the kit's triangles.

**The coping was floating, and it was real.** Verified by plan-projecting onto
the `wallTop` triangles and reading height barycentrically — not by a ray, which
against a single-sided shell cannot tell "nothing there" from "facing away", the
reason the reviewer rightly called their own check inconclusive. Bases stood up
to **0.246 m** above their own parapet. Cause: `buildCopingRun` asked the smooth
`parapetHeightFor` where to put a stone while the drawn wall is a polyline
sampled every `SHELL_STEP`; near a ramp foot the taper runs its whole range
inside one 0.6 m step. Fixed by publishing `ShellGeometry.parapetLine` and
seating the coping on it, one block per segment. The invariant then found two
more on curved seeds — both "tangent where the wall is a chord" — now also fixed.
Seating is exact on all five seeds.

**`COPING_OVERHANG` 0.11 → 0.** It broke this branch's own reason for recessing
courses inward. The arithmetic admits nothing else: inner ≥ `roadHalf` and outer
≤ `halfAcross` forces width ≤ `BRIDGE_WALL_THICKNESS`. The voussoir ring keeps
0.20 m proud and now says why — it stands only over ground the fence already
forbids to feet, which a coping running the whole length over lawn does not.

## Status: complete, PR raised, not merged

- [x] kit modelled in Blender, rendered, judged
- [x] shipped through the existing GLB pipeline
- [x] genuine three-centred arch + modelled ring + coping + imposts + coursing
- [x] parapet arc (the pronounced hump)
- [x] `ASSET_MANIFEST.md` entry
- [x] procgen invariant, broken deliberately and watched go red
- [x] `npm run build` exit 0, `npx tsc --noEmit` exit 0, `npm run test:procgen`
      **453 passed / 14 files**
- [x] second invariant, `everyCopingStoneSitsOnItsWall`, and the real defect it
      found

## ⚠️ THREE THINGS THAT ARE NOT MINE TO CLOSE

**1. The silhouette is a triangle, not a hump — and the lever is the road's.**
With `HUMP_BLEND` trimmed to 0.15 for sprint safety, the ramps are very nearly
straight lines, so the bridge's outline is a pyramid with a domed top. My
`PARAPET_CROWN_LIFT` of 0.45 m is real curvature but it is 0.45 m against a
4.24 m rise: it is a bow, not a hump. **If Jim looks at this and says it still
is not humped enough, the answer is the road's blend, not more parapet arc** —
see point 2 for why I cannot simply raise mine. The Overseer records that the
0.15 trim is provisional pending a fix to the underlying walk-physics defect;
when that lands, the blend goes back up and the silhouette follows for free.

**2. The parapet arc is capped by an absolute GAME_DESIGN rule, not by taste.**
0.45 m puts the coping's top 1.37 m over the road at the crown. At the park's
45° camera a sight line grazing the near parapet has fallen below the road by
the time it reaches a child, so she is not occluded at all — I checked the
geometry, it is in `PARAPET_CROWN_LIFT`'s own note. Going much past this starts
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

**The parapet top line** has one owner too, `parapetHeightFor` in `bridges.ts` —
the shell draws it, the collision walls stop at it, the coping sits on it. A
collider left at the un-arced height would have let a child climb the drawn
stone and step over the side.

**The flank is coursed** — levelled bands, alternate ones recessed 6 cm.
Recessed *inward* only: `halfAcross` is the width the footprint search proved
clear, so the wall may get thinner than it, never fatter. The outer wall still
runs half a metre under the terrain, which is what stops a bridge floating over
its own ground, and that stays.

## The parapet interface with the Engineer: resolved, they won

We each specified an arc and never confirmed it. Both peaked at 0.45 m at the
crown and both vanished at the feet — so they agreed at exactly the two places
anyone would spot-check — and diverged by up to **3.2 cm** across the middle of
each ramp, because mine was keyed on distance along the ramp and theirs on the
hump's own height above the ground.

Mine was deleted, not retuned. Height-above-ground is the honest variable: it
handles sloping ground under a ramp, and it tracks `HUMP_BLEND` for free, so
when #358 lands and the blend returns to 0.25 the top line follows the new road
shape with nobody remembering this exists. `parapetHeightFor` is the single
owner; the Blender preview models the same formula.

## The two render questions, answered

- **The springing was a real mesh gap.** The piers were always there (the outer
  wall runs from the springing to half a metre under the terrain) but there was
  no *impost* — the projecting course an arch is built off — so pier and
  spandrel read as one flat face. Now laid, four per bridge, a fourth copy of a
  stone already in the kit.
- **The flat-wall tunnel was the render setup.** `buildShellGeometry` has always
  swept one continuous soffit mouth to mouth; my first preview simply had no
  barrel in it, so it showed two spandrels with daylight between them. Preview
  now builds the barrel and reads as a passage.

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
