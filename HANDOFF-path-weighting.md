# HANDOFF — issue #416, pathfinding gives no weighting to paths

Branch `feat/prefer-walking-on-paths`, worktree `.claude/worktrees/path-weighting`, port **5419**.

Jim, 31 Aug: *"the pathfinding seemingly gives no weighting to paths (for player
and NPC) - make it prefer walking on paths, but off them is possible too if you
with some reasonable weighting penalty"*

## Status

- [x] Survey — both routers already share one class
- [x] `src/world/paving.ts` — the one penalty, and the paving registry
- [x] `NavGrid` — weighted A*, and weight-aware string-pulling
- [x] `check:path-preference`, in the `pnpm run check` chain
- [x] Tuning sweep, and route traces drawn and looked at
- [x] **Both mutations proven red** (transcripts below)
- [x] Full `pnpm run check` + `build` + `test:procgen`
- [x] Browser QA on 5419, player and NPC, before *and* after
- [x] `origin/main` is still 6d475dab — nothing to rebase onto yet
- [x] PR **#421**, all four CI checks green

## CI

All four required checks pass on #421 — **`Checks` (the full 47) green in
16m30s**, Procgen invariants green, PR preview deployed. `check:park-boot`
passes on CI's quieter box, which settles the local red as #324 load flake.

**Preview, checked:**
<https://pr-421-834b9ca-land-of-good-places.blockstack.workers.dev/spawn?pos=-46,-8>
— lands her on the western junction; tap up-and-right and she walks the street.
Verified headless by tapping the canvas (`window.game` is DEV-only), 0 console
errors, screenshot shows her mid-paving.

## The gate

| | result |
| --- | --- |
| `check:waypoints` | green — 240 waypoints, every one somewhere a child could stand |
| `check:park` | green — **19/19 attractions route from the entrance, 240/240 waypoints connected, all six invariants hold** |
| `check:nav-routes` | green |
| `check:path-preference` (new) | green — mean 79.8% paved, was 55.0% |
| `pnpm run build` | exit 0 |
| `pnpm run test:procgen` | 482/482, 16 files |
| `check:park-boot` | **red, and red on `origin/main` too** — see below |

`check:park-boot` is #324, the known load-dependent flake, and it was measured
on both columns on this box with nine agents running:

- branch: worst advance 24.2 ms, `cruiserSearch, 2 work units`
- `origin/main` (6d475dab, its own clean worktree): worst advance **25.3 ms**,
  `cruiserSearch, 137 work units`, 6 steps begun after their deadline

`origin/main` is *worse*. Not attributable to this change. Nothing in this
branch runs during generation — the paving stamp happens on the first route
asked for, long after boot.

## Watched running (port 5419, headless Chrome, zero console errors)

The honest before/after: **the same build, the same seed, the same spawn, the
same destination — one variable**, the multiplier flipped to 1 and back. A pair
taken from two different builds would prove much less.

Measured on the **bodies as they actually walked**, not on the routes:

| | on paving, before | after |
| --- | --- | --- |
| player tap-to-walk, one 98 m walk | **20.0%** | **63.8%** |
| the children, 21 kids in the garden, 60 s | **38.8%** | **60.1%** |

And it is not just a number — plotted over the park's own paving
(`qa-trails-before.png` / `qa-trails-after.png`, side by side in
`qa-before-after.png`), *before* is one long straight diagonal for the player
and a spider's web of diagonals for the children, cutting clean across the
middle of the park. *After*, the player's walk runs along the top street and
down the left, and the children's trails largely trace the beige. Nothing in
the after picture reads as "why did she go that way?" — which is the whole
test.

## What was built

**One definition, and it genuinely is one.** Both movers already plan on the
same class: the player's tap-to-walk grid (`src/Game.ts:388` → `TapNavigator`)
and the children's per-space grids (`src/entities/npc/journey.ts`,
`JourneyPlanner.gridFor`) are both `src/world/NavGrid.ts`, both calling
`findRoute`. So the penalty lives once, in `src/world/paving.ts`, read once, by
`NavGrid.costOf`. There is no second router to keep in step. The check asserts
this rather than trusting it: it puts the same probes through a real
`JourneyPlanner` and a player grid and requires the paved fractions to agree to
within 0.001 — worst measured disagreement **0.000%**.

**`OFF_PATH_COST_MULTIPLIER = 1.6`** — a metre of grass costs 1.6 metres of
paving. A multiplier, never a wall.

**Why NavGrid does not just import `isOnPath`:** `pathGraph.ts`'s module body
runs the whole path solve, and `NavGrid` is imported by interiors and by checks
that must not generate a park. So the direction is inverted — `buildPaths()`
**publishes** where it drew the ribbons (the same `samples[]` + `PLAZA` disc
`distanceToPath` answers from), and the router reads it. Nothing published ⇒
flat cost ⇒ interiors bit-for-bit as before.

**The trap that would have shipped this inert:** `NavGrid.smooth()` string-pulls
whenever the chord is walkable. A weighted route that went round the lawn would
be straightened right back across it. `lineIsWalkable` is now `lineCost`, and a
chord is taken only when it is no dearer than the legs it replaces (plus
`SMOOTH_CORNER_TOLERANCE = 0.08`, so a chord across the inside of the ring road
is still allowed). On uniform ground chord ≤ polyline by the triangle
inequality, so the unpaved case is unchanged.

## The tuning, measured not asserted

87 junction-to-junction routes and 109 short hops onto the grass, canonical park:

| multiplier | on paving | worst detour | worst short hop |
| ---------- | --------- | ------------ | --------------- |
| 1 (before) | 55.0%     | —            | —               |
| 1.2        | 63.6%     | +7.7%        | —               |
| 1.414 (√2) | 71.9%     | +12.3%       | —               |
| **1.6**    | **79.8%** | **+19.0%**   | **+0.2%**       |
| 1.8        | 85.9%     | +25.4%       | —               |
| 2.0        | 92.3%     | +33.8%       | +4.6%           |
| 2.5        | 94.1%     | +34.5%       | +21.5%          |

√2 ≈ 1.414 is the hard floor: below it the diagonal always beats the
right-angled walk round a grid-laid network, and *nothing changes*. Measured —
at 1.414 the paved fraction barely moves.

**1.6 was chosen on a picture, not on the table.** Routes were drawn over the
park's paving at 1.6 and 2.0 (`routes-1.6.png` / `routes-2.0.png` in the
scratchpad). At 2.0 the gate → far-ride walk runs along the top street, **dips
off it and comes back up** — a visible U, exactly *"why did she go that way?"*.
At 1.6 the same walk is clean. 2.0 is the better park numerically and the worse
one to a watching adult, and Jim's test is the adult.

**Eccentricity is bounded by arithmetic, not by hope:** on-path cost is exactly
distance walked, so an optimal weighted route can never exceed 1.6× the direct
one. Worst measured: **+19.0%**. The short hop onto grass — Jim's named failure
— costs **−0.01 m on average, +0.2% at worst**.

## Proven red by mutation

```
==================== MUTATION 1: OFF_PATH_COST_MULTIPLIER = 1 ====================
— 87 junction-to-junction routes across the built park —
FAIL  routes stay on the paving: mean 55.8% of route length is paved (floor 75%; unweighted, the same routes manage 55.8%)
FAIL  even the worst route uses the paving: 14.8% on dodgems → waterFight (floor 45%)

check:path-preference — 2 failure(s):
exit=1

==================== MUTATION 2: smoother ignores the weighting ====================
(the `chordCost > (polyCost + legCost) * (1 + SMOOTH_CORNER_TOLERANCE)` line deleted —
 i.e. the feature shipped with only half of it, which is the subtle way to get this wrong)
— 87 junction-to-junction routes across the built park —
FAIL  routes stay on the paving: mean 68.6% of route length is paved (floor 75%; unweighted, the same routes manage 55.0%)
FAIL  even the worst route uses the paving: 36.4% on stall.spaceFerrisWheel → waterFight (floor 45%)

check:path-preference — 2 failure(s):
exit=1
```

Both restored; `git status --porcelain` empty, `tsc --noEmit` exit 0, check
green again at 79.8%.

## Reachability did not shrink

The check builds a **second lattice with the paving forgotten** and compares
like for like: of 269 destinations spread over the whole park, **200 reachable
unweighted, 200 reachable weighted** — the same 200, asserted per destination,
not just by count. Grass, meadow and the gaps between attractions all keep their
routes; they cost more, they are not excluded.

## Moving under us

- **#414 step 1 has landed on its branch**: `paths.ts` now reserves the bridge
  ramp corridor at layout time, and canonical / seed 5 / seed 18 each **gained a
  bridge**. The network near bridges therefore moves. **This work needs no
  re-tuning for that** — paving is read live from `buildPaths()`'s own samples,
  so wherever the ribbons end up, that is what the router prefers — but the
  measured numbers above must be re-taken after rebasing, and the bridge decks
  are now paved cells the router will want to use.
- Files owned by others and untouched here: `src/world/paths.ts`,
  `src/world/train/*` (#414), wall placement (#417), `IsoCamera` (#420).
  This branch touches only `src/world/NavGrid.ts`, `src/world/paving.ts` (new),
  two lines of `src/world/pathGraph.ts` (the publish call), and the new check.
