# HANDOFF — crossing recovery (the converge loop)

Branch `feat/crossing-recovery`, worktree `.claude/worktrees/crossing-recovery`,
based on `origin/feat/crossing-refusal-288` (the sphere branch stack, which
already contains the **detection** half — do not rebuild it).

Contract: `docs/DESIGN-round-robin-generation.md` § "Seed 288, root-caused",
the eight numbered points under "The recovery contract"; and
`docs/BRIEF-stage4-pre-crossing-refusal.md`. Both on
`origin/design/round-robin-generation`.

---

## Status

- [x] Worktree, `pnpm install --frozen-lockfile`
- [x] Merged `origin/main` (5 commits) — the branch lacked `check:park-pool`
      and `check:swept-bus`, both of which acceptance requires
- [x] Baseline screen measured pool-wide (below)
- [ ] The converge loop
- [ ] Two deliberate red proofs
- [ ] Gates

## Merging `origin/main`: the check-chain conflict, resolved by parsing

`package.json`'s `check` chain conflicted. Resolved **deterministically from
the merge base**, not by taking a side (CLAUDE.md, and `rerere` is on):

| | steps |
|---|---|
| merge base `731f7cbe` | 60 |
| `origin/main` | 62 — adds `check:chain-coverage`, `check:seed-coverage` |
| ours (sphere branch) | 61 — adds `check:arrival-camera` |
| **resolved** | **63** |

**Neither side removed a step.** Verified by parsing the `scripts` object (never
grep — `check:park` is a prefix of `check:park-pool`): every step of base, of
main, and of ours is present in the resolution.

## Baseline — the pool-wide screen before any change

`scripts/probe-crossing-screen.mts`, one process per seed, all sixteen. This
reproduces the design doc's numbers exactly, which is what makes it a baseline
rather than a claim:

```
[1337] 23 routes, 1431 samples, 0 fouls      [225] 24 routes, 1555 samples, 0
[5]    24 routes, 1287 samples, 0            [267] 21 routes, 1252 samples, 1  <-- FOUL
[11]   24 routes, 1455 samples, 0            [274] 22 routes, 1282 samples, 0
[24]   23 routes, 1224 samples, 0            [288] 25 routes, 1342 samples, 1  <-- FOUL
[115]  22 routes, 1179 samples, 0            [326] 26 routes, 1238 samples, 0
[128]  28 routes, 1304 samples, 0            [346] 26 routes, 1434 samples, 0
[131]  25 routes, 1381 samples, 0            [428] 22 routes, 1172 samples, 0
[208]  26 routes, 1323 samples, 0            [451] 24 routes, 1574 samples, 0
```

```
seed 267: FOUL railD 213.4 at (36.9, 6.5) — no proven bridge site within SITE_SNAP_TOLERANCE
          drawn by route "spur-station-0" (#15, width 2.6, 4 control points, (32.8, 4.5) -> (37.0, 9.5))
seed 288: FOUL railD 35.1 at (-36.2, 2.8) — no proven bridge site within SITE_SNAP_TOLERANCE
          drawn by route "spur-station-1" (#17, width 2.6, 5 control points, (-22.6, 2.8) -> (-37.5, 0.1))
```

**267's producer is now attributed** (the design doc left it open):
`spur-station-0` — the *same* station-approach class as 288's `spur-station-1`.
Both fouls are the appendage producer; no second producer class is involved.

Sample counts are the instrument, not decoration: a change that leaves them
identical has moved no geometry (this is how the first one-producer fix was
caught as a no-op — 1342 before, 1342 after).

---

## Findings that shape the build

### 1. `buildGraph()` is NOT idempotent — but the rollback already exists

`paths.ts` keeps four **process-lifetime accumulators** that `pathGraphSearch()`
does not clear on entry:

| line | binding |
|---|---|
| 1680 | `pavedLatticeNodes` |
| 1681 | `pavedLatticeEdges` |
| 1682 | `usedTaps` |
| 2819 | `tapRimsDrawn` |

They are *read* as routing inputs (a paving discount in `latticeSearch` at 2640;
cost-0 nodes in `planStreetToNetwork` at 2789/2806; `ensureCompassTaps` skipping
already-used taps at 3355-3357), so **a second `buildGraph()` in one process
returns a different graph from the first**. Invisible until now because
`pathGraph.ts:49` builds exactly once.

The converge loop re-solves paths, so it must handle this. It does **not** need
a new mechanism: `latticeStateSnapshot()` (1701) / `restoreLatticeState()` (1710)
already exist for candidate rollback and cover exactly those four sets.

**Also site-dependent and must be cleared between iterations**, because
`streetLatticeSearch` registers `CROSSING_SITES` as lattice edges/taps
(`paths.ts:2330`): `latticeCache` (2061) and `streetStubsCache` (2482). Clearing
*all* the module caches is the chosen approach rather than a hand-maintained
list of which ones depend on sites — that list would be a second definition
kept in step by hand.

### 2. Where the loop lives, and the import cycle that decides it

There is an existing cycle: `crossingPlanSolve → bridgeFootprint → crossings →
pathGraph → paths → crossingPlan → crossingPlanSolve`. It is why
`crossingPredicate.ts` was split out in the first place (its own header says so).

So the loop **must not** add `paths.ts → crossingPlanSolve`. Chosen wiring, which
adds no new import edge of consequence:

- **`sampleCurve` + `drawnSamplesFor` move from `pathGraph.ts` into `paths.ts`**,
  beside `routeCurve` / `pathDivisions` / `curvePoints`, which is where CLAUDE.md
  says sampling's one owner lives. `pathGraph.ts` imports them back.
- **A new `pathGraphConverge.ts` owns the loop.** It imports `paths.ts`
  (`pathGraphSearch`, `drawnSamplesFor`, the cache reset), `crossingPlan.ts` (the
  re-solve + publish), `crossingPredicate.ts` (the screen). It must be its own
  module, not `pathGraph.ts`, because **`boot/parkGeneration.ts` deliberately
  never imports `pathGraph.ts` early** — it drives `paths.pathGraphSearch()` and
  posts to `pathsPrewarm`, and importing `pathGraph.ts` would evaluate
  `PATH_GRAPH` in the frame the slicing exists to avoid.
- `crossingPlan.ts` exposes the re-solve, so the loop never imports
  `crossingPlanSolve` directly.

### 3. Both fouling producers are the same one

267 `spur-station-0` and 288 `spur-station-1` are both the station-approach
appendage (`paths.ts:4046-4141`). The contract's rung ladder does not depend on
this, but it means the **second rung** (re-route) has exactly one producer to
expose a decision on, and `planStreetToNetwork(approach)` is already that
decision — it is what the existing detection commit reaches for.

---

## What must not change

`cruiserLowPoints()`'s 5.9 m; `SITE_SNAP_TOLERANCE` (8); `TOUCH_DISTANCE` (3.2);
`SITE_SPACING` (24). Seed 288 stays in the pool. No new warp field.
**Empty demands must reproduce today's site list exactly** — that is the
byte-identity proof, and fourteen seeds owe it.

## Deviation from the brief, to report

`scripts/park-digest-sweep.sh` (named in the brief as the byte-identity
instrument) **does not exist** on this branch, on `origin/main`, or anywhere in
the repo. The nearest existing instruments are `scripts/scatter-digest.mts` and
`check:park-pool`. Byte-identity will be proved by a per-seed digest built on
what exists; the missing script is reported rather than worked around silently.

## Gates (all read unpiped, exit codes captured)

`check`, `test:procgen`, `check:coplanar`, `check:swept-bus`, `check:park-pool`,
`build`. The last three are **standalone, not in the `check` chain** — a
three-gate green without `check:park-pool` is meaningless here (#579).
