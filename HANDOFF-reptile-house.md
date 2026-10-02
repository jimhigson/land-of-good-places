# HANDOFF — the Reptile House

**Branch:** `feat/reptile-house` · **worktree:** `.claude/worktrees/reptile-house`
· **based on:** `origin/wip/sb-merge` at its current tip (rebased 2 October
2026 from the 97-commits-stale fork; not `main` — rebase onto `main` only when
the Overseer says `wip/sb-merge` has landed). **The PR goes to `wip/sb-merge`
(or the stack branch the Overseer names), never to `main`**: against `main`
the three-dot diff carries the whole unmerged sphere/prebuilt-parks stack.
**Model:** Fable 5.1 (`claude-fable-5-1`), chosen by the Overseer's ultracode
workflow — a replacement runs the same model (CLAUDE.md). Every agent on this
effort branches **from this branch** and PRs **back into it**; the Overseer
merges this branch when the building is complete.

## State (2 October 2026, after the four-lens review)

- [x] Spec: `docs/design/REPTILE-HOUSE.md` (corrected in place where the code
      wins: no nameplates, no painted words, geometry faces with two
      catchlights). One owner of every shared number:
      `src/world/reptileHouse/layout.ts` (+ `art/blend/reptile_constants.py`).
- [x] Six kits (`house`, `cases`, `plants`, `creatures`, `noodle`, `stall`)
      with build/export/render scripts; renders under `art/renders/reptile-*/`
      are **re-rendered from the loaders' own STYLES tables** — every
      `PROPOSED` colour fallback is gone, the stall render parses its loader
      like the others.
- [x] Loaders, snake rig, reptiles, shared snake face, stall stock, the
      `'snake'` hat, the building (`ReptileHouse.ts`, `shell.ts`, `props.ts`,
      `exhibits.ts`, `planting.ts`, `floorPaint.ts`, `stall.ts`, `lighting.ts`,
      `signs.ts`), wiring (`World.ts`, `Game.ts`, `main.ts`, catalogue,
      secrets), hooks into `check:tap-spacing`, `check:copy-brevity`,
      `check:assets`, `check:deep-links`, `art/samples/main.ts`.
- [x] `scripts/check-reptile-house.mts` in `check:shard-4`, with the review's
      clauses added (below), every one proved red first.
- [ ] Placement agents (separate, later): manifest, anchor, park enlargement,
      procgen invariants. `ReptileHouse` takes `plot: PlacedEntry | null`;
      `World.ts` passes `null`.

## Engineer 3 (2 October 2026, Fable 5.1 — chosen by the Overseer's workflow; a replacement runs the same model)

Picked up after the fix agent died with its tree uncommitted; that tree is
commit `2a68c9e0` (tsc 0, `check:reptile-house` pinned exit 0, "All clauses
passed"). Doing, in this order, committing each step:

1. **Jim's ruling — the door is Sunny's open mouth** (*"Why beside the door
   and not the door as its mouth? That sounds cooler so do that."*). The head
   comes down off the roof to lie in front of the plinth, chin on the ground,
   mouth open as the arch (the bore stays `REPTILE_ARCH_WIDTH × HEIGHT`),
   the neck lifting up over the first coil's hump and diving into the crown.
   The old `rh-arch` stone tunnel becomes `rh-mouth` (pink lining + lips,
   a boolean of the tunnel with the head); `rh-awning` is gone; `rh-tongue`
   is the doormat itself, lolling out of the mouth over the plinth edge onto
   the paving (replaces `shell.ts`'s `tongueDoormat`). Colliders: jambs flush
   with the bore (`REPTILE_ARCH_WIDTH/2 + JAMB_HALF`, the review's finding),
   the head's low vertices outside the bore strip as mesh-derived discs
   (`reptileHouseLowDiscs` gains `rh-head`/`rh-mouth`), proved by the facade
   march (32 bearings, two strides) and the flood with its control.
2. **Tortoise ride** (*"Yeah, put the two rides in, why not?"*): board a big
   tortoise that plods the ring; `/tortoise-ride`; `boardRide` id
   `reptileTortoiseRide`; Coaster's board/arrive shape + TreeClimbing's
   iso-camera `setRidePose` loop; parks on a static disc off every path node.
3. **Snake egg** at the stall: `egg.snake` row + `EGG_PRIZES` snake
   hatchlings (price 0, `createPetSnake('corn'|'emerald'|'milk')`),
   `eggPrize` filtered by shop, `Shopping.buy` keyed on `kind === 'egg'`.
4. Remaining low findings: rock b into the open, dead `boardRide` branch,
   `void id`, derived constants exported as literals.

## What the review changed (all at cause; findings in the Overseer's thread)

- **Faces and planks upside-down.** The three heads and three planks are
  authored the gate arch's way (`v = (hi_z − z)/h`) and need `flipY` on:
  `art/style/glb.ts`'s **`planarUvCanvasTexture`** owns the convention beside
  `glbCanvasTexture` (glTF way, the hotel's). `snakeFace.ts`, `signs.ts` and
  the gate arch read it. Measured `dv/dy`: +1.18 `rh-sign`, +2.0 `rs-sign`,
  +0.33 `rh-head` vs −0.82 on the hotel's signboard. Sunny's and the kit
  snakes' tongues hide by `visible`, not a 0.001 scale along one axis.
- **No painted words.** TEXT RULE + the 28 July ruling: the 15 nameplates are
  gone (an exhibit's blurb is said in a bubble on its first hello), and the
  three planks wear the house motif from a 768 × 768 atlas painted **at each
  plank's measured aspect** (`SignAtlas.applyTo(plank)`). Names are the zone
  labels. If Jim wants words on the planks they need to be ~3× taller — an
  Artist job, not a font size.
- **Beds solid to the kerb.** `planting.ts` adds one capsule per outline edge
  (`REPTILE_BED_EDGE_HALF` 0.3, pulled back at convex corners), on top of the
  disc tiling. Beds notched round the hollow log (`layout.ts`) so no kerb face
  lies in the bore wall's plane.
- **Jungle to budget.** Tall clumps ≈ area/8 per bed, retried not dropped,
  sampled south of the islands' north 3 m and ≥ 1.2 m off every stand spot's
  line of sight (`sightlinesToKeep`, incl. hidden baby #2 → the grotto pool,
  which `exhibits.ts` now exports as `grottoPoolSpot()`).
- **Follow-the-snake floor** (`floorPaint.ts`): scales along every `PATHS`
  polyline (one InstancedMesh), a 2 m smiling head at the arrival, the tail
  tip by the grotto; decals at `DECAL_STEP` 0.02 layers, nothing coplanar.
- **Snake Grove**: six 2 m `grove` snakes (now `leafLight`/`flowerYellow`)
  hung from the canopy on the stand spot's side, looking at her; "Hiss hello!"
  slides one down the trunk and back (`buildSnakeGrove`).
- **Code findings**: `Player.topHeight` (hat and all) → the Noodle-o-meter
  (`meterReading`/`meterRungs` in `stall.ts`); `requestEnter` works from
  inside the hall (returning saves); `adoptRestoredPlayer` clears the other
  place's flag and `check:tap-spacing` asserts the forecourt's list; the hotel
  feast seats her own companion's `model()` (an adopted snake, not a bunny;
  `hasWalk` moved to `art/style/asset.ts`); `check:deep-links` primes both
  reptile rows inside the hall.
- **Art findings**: two catchlights per eye on every geometry face
  (`reptiles.ts`, the stall kit's snakes); `check:coplanar` clean for the hall
  — belly tube without caps, spot domes without bottoms and steeper than the
  tube's facets, the mound's foot one real ledge, the croc's jaw a real lower
  jaw seated 0.04 into the head with the beads at the mouth line, foot pads
  without bottoms, stub legs open-ended, the nursery lamp post derived from
  the rail top, the jelly bag bottomless.

## The check (`pnpm run check:reptile-house`), and how to re-arm it

Pinned to **seed 5, restart 1** (`LGP_SEED=5 LGP_PARK_RESTART=1`) for
iterating — ~35 s a run. Mutation switches, each proved red (transcripts in
the script header):

| switch | what it does |
|---|---|
| `REPTILE_CHECK_REMOVE=<solid name substring>` | removes one registered hall collider (`lagoon`, `floor rock rp-rock-a`, `the foyer log`, `bed 'swBed' edge 10`, …) |
| `REPTILE_CHECK_OPEN_SHELL=8` | removes exterior chord 8 (opposite the door) — the facade clause |
| `REPTILE_CHECK_MUTATE=faces-upside-down` | flips every painted head's and plank's texture — the painted-faces clause |

Clauses added by the review: bed probe at every corner **and edge middle**
from the nearest path node, measured at the body's edge (a centre-only read
could not see a removed edge); instanced plants probed per instance
(foliage species soft, trunks/rocks/logs/banyan solid); painted faces read
UV-vs-`flipY`; the Noodle-o-meter on a real `Player` with the real hat's
height; `/reptile-house` from inside.

`scripts/local/coplanar-hall.local.mts` (uncommitted scratch) sweeps only the
reptile spaces with outline hulls named — the sweep sees a hull's underside
as facing *up*, which is what most of the "croc" findings were.

## Deep links

- `/reptile-house` — inside, at the arrival (6, 15.8) facing north.
- `/reptile-house?at=x,z&facing=deg` — `?at=4.4,2.4&facing=267` Noodle ·
  `?at=20.4,6.5&facing=270` the nursery · `?at=15,1.8&facing=180` the lagoon ·
  `?at=-13,0&facing=90` inside the log · `?at=3.04,15.24&facing=225` the stall
  · `?at=-17.8,-12.4&facing=315` the grove.
- `/reptile-house-door` — outside on the forecourt doormat, facing the door.

Screenshots are taken headless against `vite preview` with
`__LGP_PARK_RESTART__ = 1` injected (`scripts/local/reptile-shots-2.local.mts`,
uncommitted), because the browser has no prebuilt park file (#705) and seed
5's restart 0 is refused by the rail race.

## Rules that bite here

- Never work in the shared checkout. Own worktree, own branch off
  `feat/reptile-house`, commit and push after every meaningful edit.
- `pnpm` only. Kill only your own processes by PID. Never touch port 5412.
- Blender headless only (`--background --python`). Never the live MCP session.
  `blend:reptile-<kit>` builds, exports and packs; `render:reptile-<kit>`
  re-renders from the loader's colours. The stall kit has a 2500-triangle
  budget (2401 used).
- Do not touch park generation / placement code.
- Anything drawn is solid, in the same commit; prove it with the check's
  mutation switches, red first.
- Scratch: `/private/tmp/claude-501/-Users-jim-dev-landOfGoodPlaces/92acae52-e71b-43c9-a76b-92e2c76ea5d3/scratchpad/reptile-house/<agent>/`.
