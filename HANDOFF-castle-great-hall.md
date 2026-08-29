# HANDOFF — Engineer: batch 1 placed in the great hall (#368, #380)

Branch `feat/castle-great-hall-furniture`, worktree
`.claude/worktrees/castle-place-batch1`.

**Status: complete and verified.** `npx tsc --noEmit` 0 · full unpiped
`npm run build` 0 · `npm run test:procgen` 0 (14 files, 453 tests) ·
screenshots taken from the game's own camera on a production build.

---

## 0. What this branch is, in one paragraph

PR #368 authored ten castle assets, exported them to `castle.glb`, and wired
them into **nothing** — no `castleAssets.ts`, no placement code, no player who
could see one. This is the game-side half: the asset module, the great hall's
layout, the third of `check:castle`'s three prop assertions, and one new
assertion nobody had thought of.

## 1. It stacks on two open PRs, deliberately

Base is **#385** (`feat/castle-interior-376`) with **#368**
(`art/castle-interior-assets`) merged into it. Ruled deliberate by the Overseer
after four named couplings were laid out:

1. `keepOutsFor` is `export`ed only on #385 (private on `main`).
2. `check:castle`'s assertion 1 and its three measured exemptions exist only on
   #385; writing my own would duplicate a check inside a file #385 rewrote, and
   **a merge would silently drop one of the two**.
3. #385's `placedOn(deck)` walks `dressCastle`, which is what puts this
   furniture inside all three assertions for free.
4. The hearth, rug, banners and crates this hall is laid out around are #385's.

**The #368-only fallback is still real.** `castleAssets.ts`, `castleFurniture.ts`
and the contract assertion have no #385 dependency; cutting down is about one
rebase. What would be lost is the shaft assertion's home and the tapestry/banner
coupling.

Only conflict on the merge was `package.json`'s `scripts` object, where the two
branches appended a different last line. Both kept, **verified by parsing the
object**, not by reading the diff (`rerere` is on and replays stale resolutions
silently).

## 2. Files, and who else is in them

| File | Mine? | Note |
| --- | --- | --- |
| `src/art/models/castleAssets.ts` | new, sole | STYLES for all 23 nodes, 10 factories, the published figures |
| `src/world/building/castleFurniture.ts` | new, sole | the great hall's layout |
| `scripts/check-castle.mts` | shared with #385 | +2 assertion blocks, additive |
| `src/world/building/castleDecor.ts` | **shared with #385** | one call in `dressCastle`, one filter in `bannerRun` |
| `src/world/building/castleLighting.ts` | shared with #385 | `CASTLE_TORCH_CUP` split into two readable numbers |
| `src/world/building/layout.ts` | **#377 S2 will own this** | one new export, `BUILDING_SHAFTS` |
| `src/world/building/Building.ts`, `Game.ts`, `main.ts` | `/castle?at=x,z` | |
| `art/blend/castle_build.py` | **#368's** | three `ts_const` conversions |

## 3. Every cross-side number is now *read*, not merely *agreed*

This was the Overseer's specific instruction and it is the part worth keeping.

| Figure | Owner | How the other side gets it |
| --- | --- | --- |
| `KID_HIP_HEIGHT` 0.36, `KID_REACH_HEIGHT` 1.04 | `kid.ts` | `castle_build.py` `ts_const`s them; `BENCH_SEAT = CHILD_HIP` |
| `CASTLE_TABLE_TOP` 0.675, `CASTLE_BENCH_SEAT` 0.360, `CASTLE_PLINTH_TOP` 0.250 | the emitted geometry | `castleAssets.ts` **measures** them; no literal exists |
| `CASTLE_DAIS_HEIGHT` 0.3, `CASTLE_TAPESTRY_RAIL_Y` 2.9 | `castleAssets.ts` | `castle_build.py` `ts_const`s them — **was typed on both sides** |
| `CASTLE_TORCH_CUP_OUT/_UP` | `castleLighting.ts` | `castle_build.py` `ts_const`s them and asserts its measured cup mouth equals them — **was typed on both sides** |

The last two rows are new. `castle_build.py`'s own comment said the dais and rail
should be `ts_const`'d *"the moment `castleAssets.ts` exists"*; it now does. The
torch cup was an object literal, which `ts_const` cannot read at all — its
grammar is exactly `export const NAME = <number>;` — so #385's sentence *"the
sconce is authored to land on this number"* was true only because a person had
compared two figures. It is now a build failure.

**Do not derive `CASTLE_DAIS_HEIGHT`, `CASTLE_TAPESTRY_RAIL_Y`,
`CASTLE_TORCH_CUP_OUT` or `CASTLE_TORCH_CUP_UP`.** Making any of them an
expression silently returns the Python to a typed fallback. It prints that it
has, which is the right failure, but it is not a build failure.

## 4. `surfaceTop` — the bug that nearly shipped looking like a measurement

`addOutline` attaches the inverted hull as a **child `Mesh` with real vertices**,
so `visibleBounds` counts it. Written the obvious way, `castleAssets.ts` would
have published `CASTLE_TABLE_TOP = 0.693` for a **0.675 m** table — the 18 mm
being `table-top`'s own outline, drawn behind it and invisible from the front.

That would have stood fourteen feast props 18 mm in the air and failed the
contract assertion against the Artist's published 0.675 for a reason having
nothing to do with the table. **It would have looked like a measurement, and it
was one — of the wrong quantity.**

So contract figures use `surfaceTop` (bare geometry) and `AssetHandle.height`
keeps `measuredTop` (dressed), because a name label really does have to clear the
outline. Same rule in `check:castle`: it measures each node's **own** geometry
and skips descendants.

## 5. The helter-skelter was coming down through the dinner table

**Found by looking at a screenshot, not by a check**, with three assertions
green.

Two reasons nothing could see it:

- `keepOutsFor` guards the helter's disc on `HELTER_DECK` (2) — where a child
  gets **on**, not the storey the tube passes through.
- `deckIsSolid` correctly answers *"is there floor here"*, and deck 0 has no
  holes. **A shaft is not only a hole**: it carries a stair, an escalator, a
  bubble tube, a trampoline or a helter-skelter, and those come all the way down
  through storeys whose floor is perfectly solid.

Fixed twice over: `layout.ts` now exports `BUILDING_SHAFTS` (the five fixed
shafts, *separately* from `DECK_HOLES`, which also folds in shop forecourts — a
sunken floor a prop may stand on, and asking `DECK_HOLES` gives **186 false
failures**); `check:castle` gained the assertion; and `castleFurniture.ts`'s
`hallAxis` now **chooses** its bay by testing the feast footprint against those
shafts, middle-first for composition. When #377 removes the helter the middle bay
becomes usable and the hall re-centres itself with no edit here.

## 6. Proved red — with the geometry each was proved against

Per CLAUDE.md: a red-run transcript is a measurement and measurements go stale.

**Geometry at the time:** `castle.glb` 23 nodes; `table-top` max y **0.675**,
`bench-plank` **0.360**, `plinth-block` **0.250**, `sconce-cup` mouth
**(out 0.2475, up 0.285)**. Hall axis on tapestry bay **x 9.96** (middle bay
14.95 rejected by `hallAxis`), tapestry bays at x **9.96 / 14.95 / 19.93**,
`HELTER_SHAFT` = rect(16.5, 23.5, −9.5, −2.5).

| # | Mutation | Result |
| --- | --- | --- |
| M1 | `CASTLE_TABLE_TOP` + 0.01 | 9 failures — *"publishes 0.6850 m but the 'table-top' standing in the great hall measures 0.6750 m … floating or sunk by 10 mm"* |
| M2 | feast laid at `CASTLE_TABLE_TOP + 0.018` (the dressed height) | 8 — *"a 'goblet' sits 18 mm above the table it is laid on"* |
| M3 | armour stood at `0.27` (the plinth's dressed height) | 2 — *"a suit of armour stands 20 mm above its own plinth"* |
| M4 | `CASTLE_TORCH_CUP_UP` 0.285 → 0.3025 (the real stale value) | 1 — *"Every torch in the castle would burn 1.8 cm off its own cup"* |
| M5 | `dressGreatHall` call commented out | 1 — *"deck 0 built no 'castle-furniture-0' group … This is the state PR #368 was in for a fortnight"* |
| M6 | **none — real bug**, hall axis on the middle bay | 4 — *"'bench-plank' stands in the 'helter' shaft (20/25 of its footprint)"* |

M5 is the one worth keeping: the failure mode this branch exists to fix is
itself now a build failure. M6 was not a mutation at all — it is what the check
found the moment it existed.

## 7. Colliders — what wants one once #377 lands

**Nothing here registers a collider.** Indoor collision is height-blind, so one
under the throne on deck 0 is an invisible pillar on floor 3. Placement is the
whole protection. #377's split removes that by construction; when it does:

| Prop | What it wants | Why |
| --- | --- | --- |
| **Bench**, **throne seat**, **table top**, **dais** | **Jump-on plate, never a blocking body** | A child is *meant* to climb onto all four. A blocking collider on a bench turns the one object built to be sat on into a wall. `hotel/place.ts`'s `PropPlan` already does exactly this from one footprint |
| **Armour + plinth** | Blocking, radius `CASTLE_ARMOUR_KEEP_OUT` (**0.5052 m**, measured about the origin) | A knight you walk through is not a knight |
| **Chest** | Jim's call — blocking or climb-on. 0.935 m is a fine thing to clamber onto | play-feel, not technical |
| **Tapestry, rail, sconce** | None | wall furniture, inside the 0.45 m rule |

## 8. The fourth exemption was **not** needed, and that is a finding

#376 §8.4 predicted `check:castle` assertion 1 *"would currently fail a bench"*
and asked for a fourth, measured, climb-on exemption.

**It does not fail, and I did not add one.** The hall is placed clear of every
keep-out by construction, so no exemption fires. Adding a vacuous exemption
widens a hole for free — and the criterion on offer (top at or below
`KID_HIP_HEIGHT` plus a step) would also have exempted the **chest** at 0.935 m,
letting a chest sit in a walking route.

**If a future layout does want furniture in a route**, that is when to add it,
with the bench actually failing first. The prediction was sound; the condition
just is not met yet, and it will announce itself loudly when it is.

## 9. Screenshots

`/tmp/hallshots3/` on this machine — nine, production build, port 5387, headless
`playwright-core`, **zero console errors**. Taken with
`scripts/qa-castle-interior.mjs` (extended, not rewritten).

`castle-hall-throne.png` is the one to look at: throne on its dais, two knights
on plinths, three tapestries with the torches in the clear bands *between* them,
the feast laid out, the chest.

`castle-hall-table-reach.png` answers the child-scale question directly —
Eleri at the table edge, top about waist height, bench well below her hip. That
is what 0.675 / 0.360 bought.

## 10. Open, for whoever is next

- **`/castle?at=x,z` is new.** Deck decides height, `at` decides where, in the
  **interior's own metres**. Its first version teleported to those numbers as
  *world* coordinates and photographed a field several hundred metres away —
  `worldX`/`worldZ` are the conversion.
- **The hall is on deck 0**, matching `castleDecor.ts`'s own `deck === 0` block
  so the throne and the only fireplace are in one room. #380 moves it to the
  middle floor: change `CASTLE_GREAT_HALL_DECK`, and `castleDecor.ts`'s block,
  together.
- **`npm run blend:castle` has not been re-run** on this branch. The three
  `ts_const` conversions were proved readable against the exact regex lifted
  from `blendkit.py`, but the Blender-side assertion they now drive has not
  executed. It should be run once before merge — it needs Blender on Jim's Mac.
- **`check:deep-links` hardcodes port 5173** and cannot run alongside the
  own-port rule. Not in the `build` chain, so nothing gated on it; worth an
  issue.
- **The room is still large and pink.** Three tapestries and a feast do not fill
  60 × 44 m. That is #380's job, not this branch's.
