# HANDOFF — issue #416, pathfinding gives no weighting to paths

Branch `feat/prefer-walking-on-paths`, worktree `.claude/worktrees/path-weighting`, port **5419**.

Jim, 31 Aug: *"the pathfinding seemingly gives no weighting to paths (for player
and NPC) - make it prefer walking on paths, but off them is possible too if you
with some reasonable weighting penalty"*

## Findings so far (survey, before any edit)

**Both routers already share one class.** The player's tap-to-walk
(`src/Game.ts:388` → `TapNavigator`) and the NPC drivers
(`src/entities/npc/journey.ts:287`, `JourneyPlanner.gridFor`, one grid per
space) both construct **`src/world/NavGrid.ts`** and call the same
`findRoute`. So the penalty has exactly one home: inside `NavGrid`'s A*. There
is no second router to keep in step — this is the good case for requirement 1.

**Nothing in `NavGrid` knows about paving today.** `search()` charges every
lattice step `1` (straight) or `√2` (diagonal), full stop — grass and paving
are literally the same number. That is the bug.

**Where "is this paved" already lives:** `src/world/pathGraph.ts` —
`distanceToPath(x, z)` / `isOnPath(x, z, margin)` over the drawn centreline
`samples[]` (populated by `buildPaths()`) plus the `PLAZA` disc. One owner
already; nothing new should re-derive pavedness.

**Why `NavGrid` cannot just import it:** `pathGraph.ts`'s module body runs the
whole path solve (`PATH_GRAPH = takePrewarmedPathGraph() ?? buildGraph()`), and
`NavGrid` is imported by interiors and by checks that must not solve a park.
Plan: a tiny `src/world/paving.ts` holding **the one penalty constant** and a
registry of paved discs, which `buildPaths()` fills from the same `samples[]`
it already records. Nothing paved registered ⇒ behaviour identical to today.

**The trap that will silently undo the whole feature:** `NavGrid.smooth()`
string-pulls the route straight whenever `lineIsWalkable`. A weighted A* route
that dog-legs along paving would be straightened right back across the grass.
Smoothing must compare the **weighted** cost of the chord against the weighted
cost of the polyline it replaces, and only pull when it is not worse. On
uniform terrain chord ≤ polyline by the triangle inequality, so the no-paving
case stays bit-identical to today.

**Heuristic stays admissible.** Octile distance is in cell units at cost 1; an
off-path multiplier ≥ 1 only ever makes real costs larger, so A* stays optimal.

## Plan

1. `src/world/paving.ts` — `OFF_PATH_COST_MULTIPLIER` + paved-disc registry.
2. `NavGrid`: a per-cell `paved` bit stamped at rebuild (reuse `stampCircle`'s
   machinery, not a per-cell `distanceToPath` call — that is O(cells×samples)).
3. `search()`: `step * costOf(neighbour)`.
4. `smooth()`: weighted-cost-aware string pull.
5. New `check:path-preference` in the `check` chain; prove red by mutation.

## Coordination

- **#414** owns the path network's *construction* (bridges vs. path layout).
  This work touches routing **costs** only — `NavGrid` + a new module. It does
  not change `paths.ts` layout or the crossing planner.
- **#417** (walls beside paths) likewise reads layout, not costs.

## Status

- [x] Worktree created off `origin/main` (6d475dab)
- [ ] paving.ts
- [ ] NavGrid weighting
- [ ] check + mutation proof
- [ ] browser trace, player + NPC
