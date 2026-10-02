# HANDOFF — the Reptile House

**Branch:** `feat/reptile-house` · **worktree:** `.claude/worktrees/reptile-house`
· **based on:** `origin/wip/sb-merge` (not `main`; rebase onto `main` only
when the Overseer says `wip/sb-merge` has landed).
**Model:** Fable, driven by the Overseer's ultracode workflow. Every agent on
this effort (Artists A–F, Engineers 1–4, placement) branches **from this
branch** and PRs **back into it**; the Overseer merges this branch when the
building is complete.

## State

- [x] Branch, worktree, install.
- [x] Spec committed: `docs/design/REPTILE-HOUSE.md`.
- [x] **The one owner of every shared number:**
      `src/world/reptileHouse/layout.ts` — footprint, shell, interior bounds,
      exhibit footprints and stand spots, pier posts, stall, Noodle-o-meter,
      hidden-baby spots, and the `PATHS` graph with widths.
- [x] The Blender-side accessor `art/blend/reptile_constants.py` (reads the
      TypeScript with `blendkit.ts_const`; declares no number; asserts the
      spec's relationships at import — verified green through headless
      Blender 2 Oct 2026).
- [ ] Artists A–F: `house`, `cases`, `plants`, `creatures`, `noodle`, `stall`
      kits (spec §ASSET GROUPS).
- [ ] Engineer 1: the empty greenhouse (space, shell, lighting, doors, deep
      links, check skeleton with controls).
- [ ] Engineer 2: snake rig, reptiles, gallery, asset contract.
- [ ] Engineer 3: exhibits, paths, planting, Noodle thread, hidden babies,
      full instrument.
- [ ] Engineer 4: catalogue, stall, nursery stand, pet snake, hat,
      `World.shopStands()`.
- [ ] Placement agents (separate, later): manifest, anchor, park enlargement,
      procgen invariants.

## How to read a shared number

**TypeScript:** `import { REPTILE_SHELL_RADIUS } from '../reptileHouse/layout';`
(the module is a leaf — it imports nothing — so anything may import it).

**Blender build script** (`art/blend/reptile_<id>_build.py`):

```python
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from blendkit import Part, collection, reset_scene  # noqa: E402
from reptile_constants import REPTILE_SHELL_RADIUS, TALLEST_CHILD_HEIGHT  # noqa: E402
```

Never type a figure into Python. If the number you need is not in
`reptile_constants.py`, first add the `export const NAME = <literal>;` line
to `layout.ts`, then the one-line `_layout("NAME")` read. `ts_const` is a
regex: it reads **plain literals on their own line only**, so derived values
(`REPTILE_DOOR_BAND_OUTER`) are re-derived in Python from the same literal
with the same arithmetic, not read.

`JUMP_APEX_HEIGHT` is derived in `Player.ts` and cannot be read by
`ts_const`; `REPTILE_ENCLOSURE_WALL_HEIGHT` (1.4) is asserted above it in
TypeScript at construction (Engineer 1), not in Python.

## Facts already established (do not re-derive)

- `Collision.ts` resolves a wall as a capsule (distance to the segment ≤
  halfThickness + radius), so one `addWall(a, b, half)` is a **filled**
  stadium with no hollow. Every enclosure is one wall or one disc; no
  `addRectangle` anywhere in this building.
- The repo's `ts_const` pattern (`art/blend/blendkit.py`) is the one-owner
  mechanism; `hotel/towerDimensions.ts` is the leaf-module precedent that
  `layout.ts` copies.
- `KID_EYE_HEIGHT` 1.5164, `TALLEST_CHILD_HEIGHT` 2.97 (`kid.ts`);
  `DOOR_HALF` 1.3 (`hotel/layout.ts`); `COUNTER_HALF_WIDTH` 1.65
  (`shops/stallShape.ts`); `PLAYER_RADIUS` 0.62 (`core/constants.ts`).
- The spec's original split (`shellDimensions.ts` + `constants.ts` +
  `layout.ts`) was folded into `layout.ts` alone so there is exactly one
  owner. The spec text has been corrected to match.

## Rules that bite here

- Never work in the shared checkout. Own worktree, own branch off
  `feat/reptile-house`, commit and push after every meaningful edit.
- `pnpm` only. Kill only your own processes by PID. Never touch port 5412.
- Blender headless only (`--background --python`). Never the live MCP session.
- Do not touch park generation / placement code; the building is reached
  through `/reptile-house` until the placement agents give it a plot.
- Anything drawn is solid, in the same commit; prove reachability with an
  instrument and a control first (spec §10).
- Scratch: `/private/tmp/claude-501/-Users-jim-dev-landOfGoodPlaces/92acae52-e71b-43c9-a76b-92e2c76ea5d3/scratchpad/reptile-house/<agent>/`.
