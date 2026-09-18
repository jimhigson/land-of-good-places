# Handoff — park solve time (`check:every-seed-builds` times out)

**Model: Opus 5 (1M context), chosen by the Overseer for this slice.** Branch
`fix/solve-time` off `feat/procgen-on-sphere`, worktree
`.claude/worktrees/solve-time`. Do not merge; PR against
`feat/procgen-on-sphere`.

## The root cause, measured

**80.7% of the park solve's CPU is one call site:
`brief.boundary.distanceToEdge(...)` inside `validate` in
`src/world/rail/generate.ts` (~line 770), and it is the *exact* 512-vertex
scan in `profileBoundary` (`src/world/boundary.ts`).**

CPU profile, seed 7, 90 s of the real solve
(`node --cpu-prof ... scripts/_probe-solve-time.mts`, untracked probe):

```
65.2% distanceToEdge world/boundary.ts:286
15.4% distanceToEdge world/boundary.ts:286
 4.4% clear train/route.ts:262
 3.3% (garbage collector)
 2.2% selfClear rail/generate.ts:693
```
Caller attribution of every `distanceToEdge` sample: **80.7% from
`validate rail/generate.ts:740`**, everything else ≤0.05%.

The boundary test is fifteen times more expensive than the whole park
collision test (`clear`) it runs beside.

`solverBoundary()` — the O(1) lookup-table view in the same file — already
exists for exactly this, and **the cruiser (`coaster/route.ts:923`) and the
slide (`slide/solve.ts:1515`) use it; the train does not**
(`train/route.ts:645` passes `PARK_BOUNDARY` straight into its brief). That
migration was never finished. But `solverBoundary` is *approximate*, so
adopting it changes every park.

**Chosen fix: make the exact `distanceToEdge` fast, bit-for-bit identical.**
Its coarse pass scans all 512 vertices to find the nearest one; a lazily built
per-cell candidate list (exact: every global minimiser is in the list, and the
list is in index order so first-strictly-smaller still wins the same tie)
replaces that scan with a handful of squared distances. No park changes, the
canonical hash is preserved, and `terrainHeight`/`parkLayout`/paths get the
same win for free.

## Is it a regression? No.

`git log 326de78a..HEAD` on the base is three commits, none touching the
solver. The handoff that recorded the "final proofs" also recorded
**`check:every-seed-builds` (one lane, 1538 s)** — 25.6 minutes, *already past
the workflow's `timeout-minutes: 25`*. The check has never fitted its cap;
CI's slower cores and 4-way lane contention are what made it visible.

## Measurements

Throughput probe (pieces yielded by the driver in a fixed 90 s), seed 7:

| build | turns in 90 s |
|---|---|
| base `ae20b9fc` | 3,007,377 |

(to be filled in)

## Status

- [x] root cause found and profiled
- [ ] fast exact boundary implemented
- [ ] before/after per-seed timings for seeds 3, 4, 7
- [ ] determinism (canonical hash `74191f6d7f3f5257`), `check:park` 0..15,
      `test:procgen` name-diff, `check:park-boot`
