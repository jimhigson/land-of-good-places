# Handoff — the procgen rework landed on the sphere

**Model: Fable (`claude-fable-5-1`), by Jim's standing ruling; a replacement runs
Fable.** Branch `feat/procgen-on-sphere`, cut from `origin/feat/sphere-combined`
5c322a5b. Worktree `.claude/worktrees/procgen-on-sphere`. Never the shared
checkout; never `git stash`; one heavy suite at a time (load average 215 earlier
today). **Do not merge — Jim signs the procgen work off.**

## What this branch is

`feat/sphere-combined` + one merge of `origin/feat/procgen-step2-trestles-claim`
(which carries `design/round-robin-generation`, so also **#596, the totality POI
rung — which only ever merged into the design branch, never `main`**), plus the
fixes below. The handoffs it lands are `HANDOFF-procgen-step2.md` (the step-2
engineer's record, PR body draft, merge recipe) and `HANDOFF-poi-totality.md`.

## Commits

- `ddc81610` the merge. Resolved per the step-2 recipe, audited by
  `scripts/audit-step2-merge.sh origin/feat/sphere-combined` (OK), plus:
  - **NavGrid**: #596's `forEachStep` asks the sphere's `stepAdmits`
    (`withinStep`, #660's one owner) — never its own `y` difference.
    `NAV_CELL` is the one exported pitch. `check:walk-reach`: 235700 pairs,
    **0** nav-vs-physics disagreements (control: a world-y rule would give 110).
  - **track.ts**: `TrestleTree` is solved FLAT in the chart (`trestleTreeAt`,
    `route.flatPointAt`/`baseAt`); claims (`trestleClaims`), the road rule
    (`treeStandsOn`) and the lean bound (`trunkRise` → `maxTrunkLean`) read the
    flat solve, which is the frame the registry measures in since #620.
    `leanTrestleTree` leans it (`placeOnSphere` per node) only for the draw
    loop and `addPostCollider`. Why: a straight radial trunk 100 m out has a
    2–4 m world-`xz` foot-to-top offset — the planet, not a lean.
  - **parkFacts** maps drawn strut ends back with `unplaceFromSphere`
    (terrain.ts, from `fix/sphere-procgen-triage` 0b46140e, round trip 9e-14 m)
    before rebuilding claims; `busRun` samples the road's ARC
    (`entranceBusArriveAt/VanishAt`, `entranceRoadAt/Facing`) and
    `theRoadClaimCoversTheBusRun` asks `distanceOutside`.
  - check chain = the sphere's 66 parsed steps + `check:layout-rung` = 67;
    `check:every-seed-builds` defined. `check:flat-primitives` green: four
    chart-frame sites marked `flat-ok` with reasons, one loose baseline line
    deleted.
- `fd09c5aa` **module cycle fix**: `parkLayout` (#596) floods a `NavGrid` while
  solving; `NavGrid` (#660) imported `surfaces.ts`, which reaches
  `building/layout.ts`, whose top level reads `PARK_LAYOUT` → `ReferenceError`
  on every seed. New leaves: `building/stepReach.ts` (the reach rule,
  re-exported from `surfaces.ts`) and `spaceOrigins.ts` (`worldToLocal`/
  `localToWorld`, the save origins that need `BUILDING_BASE_Y`), so
  `spaces.ts` imports only constants + floors. Proved from both entry orders.
- `12acc664` `check:swept-bus` clears the bus's whole **quaternion** for the
  in-frame measurement (on the sphere `placeBus` leans it; zeroing `rotation.y`
  left the lean in, box read 6.6–8.6 m vs the 6.04 crown).

## Measured on this branch (head 12acc664)

- `pnpm run build` 0; `tsc` 0; `typecheck:test` 0; `check:flat-primitives` 0;
  `check:park` (canonical) 0 — 19/19 attractions, 248/248 waypoints, both rings
  "candidates refused by legacy predicates: 0 — the registry decided every
  slot"; `check:ground-claims` 0; `check:layout-rung` 0; `check:walk-reach` 0.
- `check:swept-bus` 0: **0 posts on 10/10 pool seeds**, owner 6.0429 vs 6.0429
  and driven 6.4991 vs 6.4991 (both off 0.0000), both controls held.
- `test:procgen`, one seed file at a time (98 tests per file):
  canonical 10 failed, 11: 10, 24: 10, 131: 10, 326: 11 — **51, the same 51
  names as the base** (CI run 35120529727 on 5c322a5b, listed in
  `HANDOFF-sphere-procgen-triage.md`): the nine Rail Race / Sky Cruiser
  instrument-fault tests on every seed, coping stones (11, 326), slide vs
  towers (24, 326), slide vs roof garden (131), path on a bridge (canonical).
  **Failing-name diff against the base: empty.** The two new invariants
  (`railRaceSupportsAreClaimedAsDrawn`: 100 trestles, 700 struts, worst lean
  0 % of its limit; `theRoadClaimCoversTheBusRun`: 87 samples, 0 outside) pass
  on every seed; `0 bars lost to the road rule` on the canonical seed.
- **Seeds 0..15**, each built alone with `LGP_SEED=<n> pnpm run check:park`
  (logs in the session scratchpad, `seeds/<n>.log`):

  | seeds | result |
  |---|---|
  | 2, 5, 7, 11, 13, 14, 15 | **BUILT, check:park green** (19/19 attractions route, 0 rail crossings) |
  | 4, 6 | built; check:park red on its own ratchet — 4: `poi.nospot` 2 (waypoints at (-16.3, 58.3), (-20.3, 58.7) with nowhere to stand) + `rail.walkable` 1; 6: `rail.walkable` 1 + `anchor.reach:waterFight` 0.1 |
  | 0, 8, 10 | **not built**: the Sky Cruiser's coaster route is unsolvable (`coaster/route.ts`, every attempt dead-ends) |
  | 3, 9 | **not built**: the railway loop is unsolvable (`rail/generate.ts`, 96 attempts) |
  | 1, 12 | **not built**: a drawn path crosses the railway where no bridge site is proven (`train/crossings.ts`, railD 175.2 / 83.8) — the `railD` crossing throw, step 3 of the agreed order |

  No seed is refused by a trestle: on every seed whose ring is built, both
  rings report "candidates refused by legacy predicates: 0 — the registry
  decided every slot". Against #596's hill-era baseline
  (`every-seed-builds-baseline.mts`: 0, 8, 9, 10 rail; 2, 3, 7 crossing; 6,
  12 reach): **2 and 7 now build**, 12 moved from `anchor.reach` to the
  crossing throw, 4 newly red on `poi.nospot`/`rail.walkable`. The five
  unsolvable/crossing seeds are other producers' (coaster, railway, paths) —
  stage 4 work, not this branch's.

## Not done / open

- The 40 instrument-fault reds (Rail Race, Sky Cruiser drawn leant vs flat
  plans) are the base's and stay red; `unplaceFromSphere` is on this branch
  for whoever converts them. Not this lane's, by the coordinator's ruling.
- Steps 3, 4 and stage 4 (paths/railway migration) are briefs only, never
  built anywhere; awaiting Jim's word.
- `check:every-seed-builds` (#596's ratchet, baseline taken on the hill) has
  not been run to completion here (killed at 600 s); its workflow runs it.
- Full `pnpm run check` (67 steps, ~26 min) not run locally — take it from CI.
