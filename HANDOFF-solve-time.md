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

## Read the counts, not the seconds

**Wall-clock seconds on this Mac are contaminated and must not be quoted as a
clean before/after.** Load average ran 15–55 against 14 cores throughout, with
seven other agents building parks. Another engineer measured seed 7 at 1334 s
where the handoff records 1003 s, *with the driver counts identical* — so the
whole 331 s was sibling agents.

So the honest comparison here is the **deterministic** part of the trace:

- the driver's own counts (`refusals`, `retries`, `unwinds`, `decision-zero`,
  `worst-attempt`), and
- **the per-solver piece counts in `park-solve: … time/pieces`** — how many
  candidates the search actually tried.

Those cannot move unless a decision moved. Every seconds figure below is a
**ceiling** (contention only ever makes it worse), and the one number that had
to be clean — the sweep's wall clock, because the cap is in minutes — is
re-taken on a quiet machine and labelled as such.

The base side of the CI argument needs no re-measurement: **CI itself is the
base measurement** (24m57s, `cancelled`, seed 7 unfinished), corroborated by
`HANDOFF-backtracking.md`'s own recorded 1538 s.

## Measurements

Throughput probe — driver pieces yielded in a fixed 90 s, seed 7
(`LGP_SEED=7 LGP_PROBE_MS=90000 … scripts/_probe-solve-time.mts`, untracked):

| build | turns in 90 s |
|---|---|
| base `ae20b9fc` | 3,007,377 |
| with the fix | 11,280,080 |

**3.75×.**

Seed 7, base, one `check:park` process alone, quoted off the screen:

```
park-solve: seed=7 increments=58 refusals=42 retries=23 accommodations=0 unwinds=31 deepest-unwind=5 decision-zero=2 worst-attempt={"cruiser":5,"train":5,"layout":2}
park-solve: seed=7 time/pieces layout=187ms/2429p cruiser=13344ms/2347637p train=1207376ms/35960103p slide=9636ms/755401p crossings=255ms/2054p pathGraph=1120ms/2129p road=0ms/0p
check:park: 19/19 attractions route from the entrance, 0 rail crossing(s), 253/253 waypoints connected. All six invariants hold. 1234623 ms.
```

**97.8% of seed 7's 1234.6 s is the train's rail search**, which is the thing
the boundary scan was inside.

### `check:every-seed-builds`, the whole thing, on the branch

Quoted off the screen. **All sixteen seeds, 299.7 s against the workflow's
25-minute cap** — and taken on a box whose load average was 15–40, with four
other agents' park builds running, so it is a ceiling rather than a best case.

```
  seed   0: built      14.4s  19/19 attractions … 254/254 waypoints connected. All six invariants hold.
  seed   1: built       8.4s  … 228/228          seed   2: built      14.1s  … 233/233
  seed   3: built      30.7s  … 237/237          seed   4: built      59.5s  … 237/237
  seed   5: built        12s  … 242/242          seed   6: built       8.3s  … 230/230
  seed   7: built       277s  … 253/253          seed   8: built      10.7s  … 278/278
  seed   9: built       8.2s  … 235/235          seed  10: built         8s  … 216/216
  seed  11: built       8.9s  … 308/308          seed  12: built       7.1s  … 275/275
  seed  13: built       5.3s  … 246/246          seed  14: built       8.4s  … 214/214
  seed  15: built      15.8s  … 263/263
  every seed: built well? decision-zero=0 rung-fired=0

check:every-seed-builds: built 16/16; by class: none unbuilt
check:every-seed-builds OK — 16 seed(s) swept; 16 build, 0 do not, all within
the baseline … Every swept seed builds. 299.7 s.
```

This **is** `LGP_SEED=n pnpm run check:park` on 0..15 — the script runs exactly
that, one process each, and the counts above are its output.

### Per-seed, before and after

| seed | base | with the fix | |
|---|---|---|---|
| 3 | 119.4 s | 30.7 s | 3.9× |
| 4 | 232.1 s | 59.5 s | 3.9× |
| 7 | 1234.6 s (solo) | 277 s | 4.5× |

Base seeds 3 and 4 measured the same way (`check:every-seed-builds` with
`LGP_SEEDS=3,4,7`); seed 7's base is the solo `check:park` quoted above, which
is the kinder of the two measurements for the base.

### Seed 7 — the same decision path, byte for byte

The hardest seed in the sweep, base vs branch, both `LGP_SEED=7 check:park`:

```
BASE    increments=58 refusals=42 retries=23 accommodations=0 unwinds=31
        deepest-unwind=5 decision-zero=2 worst-attempt={"cruiser":5,"train":5,"layout":2}
        layout=187ms/2429p cruiser=13344ms/2347637p train=1207376ms/35960103p
        slide=9636ms/755401p crossings=255ms/2054p pathGraph=1120ms/2129p seams=64
        19/19 attractions, 0 rail crossing(s), 253/253 waypoints. 1234623 ms.

BRANCH  increments=58 refusals=42 retries=23 accommodations=0 unwinds=31
        deepest-unwind=5 decision-zero=2 worst-attempt={"cruiser":5,"train":5,"layout":2}
        layout=221ms/2429p cruiser=14518ms/2347637p train=273196ms/35960103p
        slide=11090ms/755401p crossings=257ms/2054p pathGraph=1076ms/2129p seams=64
        19/19 attractions, 0 rail crossing(s), 253/253 waypoints. 305449 ms.
```

**Every driver count and every piece count identical** — 58 increments, 42
refusals, 23 retries, 31 unwinds, 2 decision zeros, the same worst attempt per
feature, and **35,960,103 train candidates on both**. Those base counts are
also exactly what `HANDOFF-backtracking.md` records and what a second engineer
measured independently, so all three runs are the same park.

Train **1207376 ms → 273196 ms, 4.42×**; the park 1234623 ms → 305449 ms.

**The handoff's line "the cost is the train's dead-end searches at ~20 s each"
is not made false by this, only cheaper** — those searches are still where seed
7's time goes, at roughly a quarter of the price. Making that line stop being
true means re-solving the railway fewer times, which is the `crossings` supply
question below, not this change.

### Seed 428 — the pool seed the `check:entrance-road` engineer root-caused

**Base and branch measured in two processes started together and running
side by side**, so both carried the same sibling load — the fairest comparison
this machine allows:

```
BASE    layout=91ms/789p cruiser=982ms/112707p train=237670ms/6167553p
        slide=4046ms/787956p crossings=57ms/427p pathGraph=326ms/601p road=0ms/0p seams=16
        check:park: 19/19 attractions, 0 rail crossing(s), 240/240 waypoints. 246214 ms.

BRANCH  layout=82ms/789p cruiser=855ms/112707p train=39551ms/6167553p
        slide=4772ms/787956p crossings=54ms/427p pathGraph=316ms/601p road=0ms/0p seams=16
        check:park: 19/19 attractions, 0 rail crossing(s), 240/240 waypoints. 49555 ms.
```

**Every piece count is identical, in all seven solvers**: 789, 112707,
**6167553**, 787956, 427, 601, and 16 cruiser-finish seams. The search makes
precisely the same decisions and tries precisely the same candidates. Only the
time for them moved: **train 237670 ms → 39551 ms, 6.01×**; the whole park
246214 ms → 49555 ms, 4.97×.

**That identical piece count is the load-bearing evidence on this branch, and
it does not depend on wall clock at all.** A different park would not try the
same 6,167,553 candidates.

It also shows how contaminated the seconds are: the same base seed measured
`train=177585ms` for the `check:entrance-road` engineer and `train=237670ms`
for me, on the same commit, for the same 6,167,553 pieces. Same work, 34% more
seconds. Quote the counts.

It also answers that engineer's caution that a fix proven on seeds 0..15 might
leave `PARK_SEED_POOL` slow: the win is in the inner loop of the rail search,
so it is indifferent to which seed is being solved.

**What it does *not* fix, and should not be reported as fixed:** the driver
still solves seed 428's railway five times. `crossings` has `supply: 1`, so a
`pathGraph` refusal naming `crossings, train, cruiser, layout` finds
`crossings` exhausted at once and unwinds onto the train's ladder — spending a
whole railway search where a different crossings decision would cost 54 ms.
That lever is real and it is the right next ticket, but it is **not this one**:
it changes the search's decisions, so it re-draws every park on every seed and
needs its own sweep. Note also that it is now worth about a quarter of what it
looked like — the railway searches it avoids cost ~9 s each on this branch, not
~35 s — so **re-measure before sizing it**.

## Determinism: the park is unchanged, not merely deterministic

`scripts/park-digest.mts`, canonical seed, base worktree vs this branch —
identical on all four digests:

```
seed canonical: meshes=5536 park=a1b5c16077708bc0
  trace a4e2cf23fc5b3676 (3 line(s))
  plan-trace 530be81588feb072 (15 line(s))
  world-trace 69f4ec1f24c20397 (648 line(s))
```

**The handoff's recorded canonical hash `74191f6d7f3f5257` is stale**: the base
commit `ae20b9fc` itself prints `a1b5c16077708bc0`, measured in a clean
worktree of `origin/feat/procgen-on-sphere`. The number was right once and
nothing announced when it stopped being.

## Status

- [x] root cause found and profiled
- [x] fast exact boundary implemented; bit-identical over 244,205 points on
      five profiles, and the comparison watched go red against a mutated
      reference (`scripts/_probe-boundary-exact.mts`, untracked)
- [x] canonical park digest unchanged against the base
- [x] before/after per-seed timings for seeds 3, 4, 7
- [x] `check:every-seed-builds` green, 16/16, 299.7 s
- [x] `check:park-boot passed`
- [x] `test:procgen` name-diff against the base: **identical failure sets**
- [ ] PR against `feat/procgen-on-sphere`

### `test:procgen` name-diff

```
base    Test Files  5 failed | 17 passed (22)      Tests  55 failed | 636 passed (691)
branch  Test Files  5 failed | 18 passed (23)      Tests  55 failed | 638 passed (693)

only on base (fixed):  (none)
only on branch (NEW):  (none)
```

Failing **names** diffed, not counts — a count cannot see a swap. The `+1` file
and `+2` tests are `test/geo/boundaryDistance.test.ts`, both passing; every
other number is unmoved.

**`tsc --noEmit` is not evidence about `scripts/`** (it sits outside every
tsconfig project). Nothing in this diff is a check script — it is
`src/world/boundary.ts`, a test under `tsconfig.test.json`, a workflow comment
and this file — and the test was run, not merely typechecked.

## For whoever takes this over

Worktrees: `.claude/worktrees/solve-time` (the branch) and
`.claude/worktrees/solve-time-base` (a detached checkout of
`origin/feat/procgen-on-sphere`, purely for before/after measurement — remove
it when done). Untracked probes in `scripts/`:
`_probe-solve-time.mts` (drive the plan, print slow turns, stop after
`LGP_PROBE_MS`) and `_probe-boundary-exact.mts` (the bit-identity control,
`--mutate` to watch it fail).

**The box is shared.** Load average ran 15–40 with four other agents building
parks throughout. Kill your own node by PID, matched on working directory
(`lsof -a -p $p -d cwd`), never `pkill -f`.
