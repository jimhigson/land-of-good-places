# HANDOFF — the Reptile House

**Branch:** `feat/reptile-house` · **worktree:** `.claude/worktrees/reptile-house`
· **based on:** `origin/wip/sb-merge` (not `main`; rebase onto `main` only
when the Overseer says `wip/sb-merge` has landed).
**Model:** Fable 5.1 (`claude-fable-5-1`), chosen by the Overseer's ultracode
workflow — a replacement runs the same model (CLAUDE.md). Every agent on this
effort (Artists A–F, Engineers, placement) branches **from this branch** and
PRs **back into it**; the Overseer merges this branch when the building is
complete.

## State (2 October 2026)

- [x] Spec: `docs/design/REPTILE-HOUSE.md`. One owner of every shared number:
      `src/world/reptileHouse/layout.ts` (+ `art/blend/reptile_constants.py`).
- [x] Artists A–F merged: `house`, `cases`, `plants`, `creatures`, `noodle`,
      `stall` kits, each with build/export/render scripts, renders under
      `art/renders/reptile-*/`, recorded in `ASSET_MANIFEST.md` §35–40.
- [x] Loaders: `src/art/models/reptile{Kit,HouseAssets,CasesAssets,PlantsAssets,
      CreaturesAssets,NoodleAssets,StallAssets}.ts` — STYLES tables, every
      shared number re-asserted against `layout.ts` at load, `markShared`.
- [x] Snake rig `src/art/models/snake.ts` (instanced segment pool, pet, plush),
      reptiles `reptiles.ts`, shared face `snakeFace.ts`, stall stock
      `snakeToys.ts`, the `'snake'` hat in `hats.ts`.
- [x] The building `src/world/reptileHouse/`: `ReptileHouse.ts` (doors, spaces,
      forecourt, zones), `shell.ts`, `props.ts` (one placement call, keep-outs),
      `exhibits.ts` (15 exhibits, Noodle thread, hidden babies), `planting.ts`
      (beds as disc tilings, instanced plants), `stall.ts` (Scales & Tails,
      Noodle-o-meter, two `ShopStand`s), `lighting.ts`, `signs.ts` (one atlas).
- [x] Wiring: `World.ts` (construct, zones, roots, update, `shopStands()`,
      `playerInAnyInterior`), `Game.ts` (`boardRide` ids, `enterReptileSpawn`,
      `adoptRestoredPlayer`), `main.ts` (`/reptile-house`, `/reptile-house?at=`,
      `/reptile-house-door`), `Shopping.openShopById` reads `World.shopStands()`,
      catalogue rows (`REPTILE_ITEMS`), `secrets.ts` (two deeds).
- [x] `scripts/check-reptile-house.mts`, in `check:shard-4` (parsed, verified).
      Hooks into `check:tap-spacing`, `check:brevity`, `check:assets`,
      `check:deep-links`, `art/samples/main.ts`.
- [ ] **Run the checks to green** — see "Where this is" below.
- [ ] Placement agents (separate, later): manifest, anchor, park enlargement,
      procgen invariants. `ReptileHouse` takes `plot: PlacedEntry | null`;
      `World.ts` passes `null`. With a plot the exterior stands in the park
      and leaving lands on `plot.entranceX/Z`.

## Where this is

`tsc --noEmit`, `typecheck:test` and `pnpm run build` exit 0. The hall
builds in the real harness with zero keep-out violations (the first two
builds found ten, all fixed by moving nodes/props — `props.ts` reports them
by name).

**The acceptance loop is the slow part.** Any edit to `src/`, `scripts/`,
`test/procgen/` or `package.json` changes `acceptanceSourceHash()`
(`scripts/lib/acceptedPark.mts`), and the first headless build of a seed then
re-runs `accept-parks` for it (minutes, several restarts). To iterate on the
hall without that, pin the restart: `LGP_SEED=5 LGP_PARK_RESTART=<r>` — but
seed 5's restart 0 is refused by the rail race (`DuckBarRefusal`) and restart
1 by two invariants, so **the accepted restart has to be learnt from
`pnpm run accept:parks 5`** (log in the scratchpad `build/accept5.log`), then
pinned for iteration. The final unpinned runs are what CI does.

The check itself has a `REPTILE_CHECK_REMOVE=<solid name substring>` switch
that removes one registered collider after the build, for proving it red.

## The design decisions worth knowing

- **The forecourt.** While `placedEntry('reptileHouse')` does not exist, the
  exterior stands on its own flat lawn — a disjoint space at (600, −900),
  `SPACE_REPTILE_FORECOURT` — so `/reptile-house-door` lands her on the
  doormat there and leaving the hall comes back out to it. Nothing in
  procgen was touched.
- **No rectangles.** Every solid is a filled disc or a filled capsule
  (`addWall`); beds are tilings of r 1.2 discs inside their drawn outline
  (`planting.ts`), thin beds take the largest disc they can hold.
- **Keep-outs** (`props.ts reptileKeepOuts`) are asserted against every
  placement; `assertClear()` throws once with all violations.
- **Pets are catalogue entries, not `PetKind`s**: `pet.snakeMint/Coral/Rainbow`
  use `createPetSnake` (sized to `PET_RENDER_HEIGHT`) and walk in the parade
  as walkers. Extending `PetKind` would have put wild snakes on the castle
  roof and three more statues in the hotel; the spec's "if the store keys on
  PetKind alone" condition is false — it keys on the catalogue id.
- **Noodle's stand spot** moved off her bearing to (4.4, 2.4) facing 267
  (the Artist's sightline note); her snout's 0.3 m overhang gets one disc
  derived from the measured reach.
- **One sign canvas** (`signs.ts` atlas, 2048 × 1152, 18 cells); one snake
  face set (5 textures) shared by every snake, Noodle and Sunny.
- Reptile faces are **geometry** (ink blobs, catchlights, blush, w-mouth), no
  canvas.
- The camera-ray sightline probe in the spec (§10.8) is **not** implemented;
  the sightline rule is applied by hand in `planting.ts` (no tall planting in
  the north 2 m of the island beds, near-side beds low).

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
(`REPTILE_DOOR_BAND_OUTER`, `REPTILE_BACK_WALL_ALONG`) are re-derived in
Python from the same literal with the same arithmetic, not read.

## Deep links

- `/reptile-house` — inside, at the arrival (6, 15.8) facing north.
- `/reptile-house?at=x,z&facing=deg` — inside, at a hall-local spot:
  `?at=4.4,2.4&facing=267` Noodle · `?at=20.4,6.5&facing=270` the nursery ·
  `?at=15,1.8&facing=180` the lagoon · `?at=-13,0&facing=90` inside the log ·
  `?at=3.04,15.24&facing=225` the stall.
- `/reptile-house-door` — outside on the forecourt doormat, facing the door.

## Rules that bite here

- Never work in the shared checkout. Own worktree, own branch off
  `feat/reptile-house`, commit and push after every meaningful edit.
- `pnpm` only. Kill only your own processes by PID. Never touch port 5412.
- Blender headless only (`--background --python`). Never the live MCP session.
- Do not touch park generation / placement code; the building is reached
  through `/reptile-house` until the placement agents give it a plot.
- Anything drawn is solid, in the same commit; prove reachability with an
  instrument and a control first (`check:reptile-house` does both).
- Scratch: `/private/tmp/claude-501/-Users-jim-dev-landOfGoodPlaces/92acae52-e71b-43c9-a76b-92e2c76ea5d3/scratchpad/reptile-house/<agent>/`.
