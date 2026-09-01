# HANDOFF — coplanar faces on the roof, and where else they are (#467)

Branch `feat/castle-roof-garden-outside` (PR #465), worktree
`.claude/worktrees/castle-roof` (the branch's existing one; it was clean at
`origin`'s tip when this task started). Dev server port **5563**, killed by
PID when not in use.

## What was wrong

`buildDeck` extrudes the roof deck as a 0.3 m slab hanging under the walking
surface (`position.y = -BUILDING_SLAB`, so it occupies `y ∈ [-0.3, 0]`), and
`buildRoofCurtainWalls` hangs 18 m of wall off the **same two edges** with its
top at the same `y = 0`. Along the east (+X) and south (+Z) runs the slab's
outer `ROOF_PARAPET_THICKNESS` band therefore sat **inside** the wall: five
pairs of same-plane, same-facing faces, measured on the built shell —

| plane | what met what |
|---|---|
| `x = +ox` | deck's east face vs the wall's outer face |
| `z = +oz` | deck's south face vs the wall's outer face |
| `y = 0` | deck's top vs the wall's top cap, under the parapet kerb |
| `x = -ox` | deck's west face vs the south wall's end cap |
| `z = -oz` | deck's north face vs the east wall's end cap |

A child sees the first two: a 0.3 m strip at the top of the 18 m drop, right
under the battlement, which strobes between the deck's pink and the wall's
cream as the camera moves.

## The fix

`roofDeckShapes()` — the top deck's plate stops at the wall's inner face
instead of running under it, and the wall fills the band. That line is the one
the perimeter collider already stops her at (`ROOF_EDGE_* -
ROOF_PARAPET_THICKNESS`, `layout.ts`), so nothing walkable was removed. No
offset to keep in step; the deleted faces were never visible (ART_DIRECTION §7).

The slide's doorway is the one place the wall steps aside, so the plate carries
on to the edge there — otherwise there would be a notch in the floor at the
slide mouth. Both read from the new `ROOF_SLIDE_GAPS`, now the single owner of
that opening for the kerb, the merlons, the curtain wall and the plate (it was
the same literal written out four times).

Re-measured after: **0** `deck-2`/`roof-curtain-wall` pairs, on the shell and
on the whole park.

## Proved on screen

`/castle?deck=2&at=17,11`, walking her along the south parapet so the camera
moves with her. Screenshots in the session scratchpad:

- `before-f-crop.png` — fix reverted: heavy diagonal hatching all along the
  seam and down the wall face. That is the two surfaces interleaving.
- `after-f-crop.png`, `after-g-crop.png` — fix in place, **two different
  camera positions**: one continuous kerb band, no hatching anywhere.

Trap hit on the way: a saved game overrode the deep link mid-session twice
(she resumed in the ball pit, then on the rail race). `localStorage.clear()`
then navigate.

## Gates

`build` 0 · `test:procgen` **502 passed / 16 files** · `check` — see the PR.

## The instrument

A coplanar-face sweep was written for this and lives in the session scratchpad
(`_scratch-coplanar.mts`, `_scratch-park-coplanar.mts`) — deliberately **not**
committed. It walks a built `Object3D`, buckets every world-space triangle by
(normal, plane offset), and reports overlapping pairs from different meshes;
a second pass casts the fixed isometric's own sight line at each seam to say
whether a child could ever see it. Two things it taught, worth keeping:

- **The plane tolerance decides what you find.** At 1 cm it flagged 31 visible
  mesh pairs; at 0.1 mm, 19. The twelve that dropped out are deliberate
  sub-centimetre stand-offs (the roof burrows' mouths at 5 mm, the mall
  roundel, the TV screen) — real per ART_DIRECTION's "an offset is a number
  somebody must maintain", but not z-fighting today.
- **Opposite-facing coplanar faces do not fight**, because backface culling
  only ever draws one of them. Two abutting solids are fine; only same-facing
  pairs strobe. The sweep buckets on the signed normal for that reason.

The list of other instances is in the PR comment and in #467.
