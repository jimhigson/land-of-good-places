# Handoff — `check:entrance-road` times out in CI

Branch `fix/entrance-road` off `feat/procgen-on-sphere`, worktree
`.claude/worktrees/entrance-road`. PR against `feat/procgen-on-sphere`. Do not
merge.

## The report

PR #667 head `ae20b9fc`: workflow `Entrance road` (`timeout-minutes: 15`)
CANCELLED = timed out. Step "Entrance road sweep" ran 14m56s and produced
**zero output** before the kill.

## What the workflow history says (measured, `gh run list`)

Durations of whole runs on `feat/procgen-on-sphere` (short ones are
`cancel-in-progress` supersessions, ignore those):

| commit | dur | conclusion |
|---|---|---|
| ebaafe86 | 246 s | success |
| 6d2cecd1 | 274 s | success |
| e292f5c6 | 324 s | success |
| 4a824c75 | 303 s | success |
| af63abee | 353 s | failure (assertion) |
| **3d797f67** | **919 s** | **cancelled (timeout)** |
| b449fcd3 | 920 s | cancelled |
| 5c510148 | 917 s | cancelled |
| 6f191a30 | 901 s | success (squeaked in) |
| accd2054 | 918 s | cancelled |
| 9a4fcb09 | 934 s | cancelled |
| d2efafa3 | 939 s | cancelled |
| ae20b9fc | 922 s | cancelled |

**The step goes from ~5 min to ~15 min at `3d797f67`** — "parkPlan: plan-time
crossing screen marches the esplanade too; boundary screen at the wall itself"
(touches `parkPlan.ts`, `train/crossingPredicate.ts`, `train/crossings.ts`).

## The shape of the check (why zero output)

`scripts/check-entrance-road.mts` `sweepThePool()` forks **one child process per
(seed, real|control)** — 10 pool seeds × 2 = **20 children** — and launches them
through `Promise.all` over `PARK_SEED_POOL`, i.e. **10 concurrent lanes**, each
lane doing `real` then `control`. Every line of output (the per-seed table, the
stderr notes, the verdict) is printed only *after* `Promise.all` resolves. So a
sweep that is merely slow is indistinguishable from a hang: it prints nothing
until it prints everything. That is not the cause, but it is why CI showed
nothing for 15 minutes.

## Local timings — one child (`--one`, the real pass) at a time, this Mac

| seed | elapsed |
|---|---|
| 20260728 (canonical) | 15 s |
| 11 | 7 s |
| 24 | 8 s |
| 128 | 6 s |
| 131 | 5 s |
| 208 | 11 s |
| 274 | 26 s |
| 326 | 15 s |
| **428** | **185 s** |
| 451 | 3 s |

Nothing hangs. Seed 428 is the whole story.

## ROOT CAUSE (measured, seed 428's own `park-solve:` trace)

```
park-solve: seed=428 time/pieces layout=61ms/789p cruiser=764ms/112707p
  train=177585ms/6167553p slide=3556ms/787956p crossings=46ms/427p
  pathGraph=290ms/601p road=0ms/0p
```

**178 of the 185 seconds is the railway route solver, run five times.** The
trace shows why: `pathGraph` refuses three separate times with
`consumed=crossings,train,cruiser,layout`; `crossings` has `supply` 1 so it is
exhausted immediately, and every one of those refusals therefore unwinds onto
the **train's** attempt ladder. Four of the five railway solves dead-end
(`all 96 attempts were tried and every one dead-ended`, ~470 000 candidate
pieces each) at roughly **35 s apiece**, and 35 s is simply what one railway
route search costs on this seed, success or failure.

The third refusal names its culprit:

```
refused pathGraph#0 ... 1 drawn crossing(s) off every proven site —
  first at railD 46.9 (-0.1, 53.6) by drawn run -2
```

`run -2` is the **esplanade** — the un-drawn walk in from the arch that
`3d797f67` added to the plan-time crossing screen
(`crossingPredicate.esplanadeSamples`, passed as `esplanadeOver`). That is the
commit CI's own durations pin the 5 min → 15 min jump to. The screen is right
(it is what stopped seed 7 throwing out of tree planting); what it costs is a
further trip round the train's ladder, i.e. two to three more 35 s railway
searches, and seed 428 goes from roughly one railway solve to five.

**This is the same root cause as the `check:every-seed-builds` regression the
other engineer is on** (individual seeds 4–199 s → 574 s and 846 s): an unwind
that lands on the train re-runs a 20–40 s railway route search, and the new
plan-time screens produce more such unwinds. The handoff for the backtracking
work already records seed 7 at 1003 s with "the cost is the train's dead-end
searches at ~20 s each" — the same sentence, a different seed.

## Why 185 s locally becomes a 15-minute CI timeout

`sweepThePool()` does:

```ts
await Promise.all(PARK_SEED_POOL.map(async (seed) => ({
  real:    await measure(seed, false),
  control: await measure(seed, true),
})))
```

Two things follow, and both are defects of the check rather than of the park:

1. **The worst seed is serialised with its own control inside one lane.** Seed
   428's lane is `real` *then* `control` — 2 × 185 s locally, and a CI core is
   roughly 2.5× slower, which lands squarely on the 14m56s that was observed.
   Meanwhile ten lanes are launched at once with no bound, on a four-vCPU
   runner.
2. **Every line the check prints is printed after `Promise.all` resolves.** So
   a merely slow sweep and a genuinely hung one look identical from CI — which
   is exactly what the operator saw: the command echo, then nothing, then
   `##[error]The operation was canceled.` Fifteen minutes of a check that
   could not say which seed it was on.

## The fix

Not a bigger `timeout-minutes` (CLAUDE.md is explicit, and the 29 August outage
was that mistake). Instead:

- put all 20 jobs (10 seeds × real/control) through **one bounded queue** sized
  to `cpus()`, like `check-every-seed-builds.mts` already does
  (`LGP_LANES`), so the worst seed is never doubled up behind itself;
- **stream a line per finished job to stderr** with its wall time, so a slow
  run says which seed it is on and a timeout names it.

Two things still sit above that floor afterwards, and neither is fixed here:

1. **Scheduling.** The queue dispatches in `PARK_SEED_POOL` order, so the
   longest park goes almost last and 208 s of tail remains — see "Headroom"
   below. Longest-first is the fix and is its own issue (the queue has no cost
   hint to sort on).
2. **The solver.** The floor itself is one seed-428 park. Lowering it means
   changing how the driver answers a `pathGraph` refusal — the cheap decision
   is a different `crossings` decision (prove a site at the fouled rail
   distance) rather than re-rolling the whole railway — which belongs with the
   backtracking/every-seed-builds engineer, not here.

## The control on the measurement

Seed 428 built through the **same script** on `origin/feat/sphere-combined`
(the base this branch forked from, worktree
`.claude/worktrees/entrance-road-base`, detached at `5c322a5b`):

```
BASE seed=428 rc=0 elapsed=10s      # vs 185 s on this branch — 18.5x
```

So seed 428 is not an inherently expensive park; it is one that the new driver
solves the railway for five times instead of once.

## Proofs (local)

`pnpm run check:entrance-road` on head `6cd4d7f4`, quoted off the screen:

```
HEAD-FULL rc=0 elapsed=243s   # 14 lanes on 14 cpus (this Mac)
LANES4    rc=0 elapsed=288s   # LGP_LANES=4, the CI-shaped run
entrance road OK — the bus's swept body clears every trestle post along the
whole 145.7 m road on all 10 pool seeds; the tightest anywhere is 6.05 m (seed 24)
```

(An earlier `FULL rc=0 elapsed=221s` in this file was measured *before* the
completeness-guard commit `81bfb286` and so was not of the merge candidate.
`243s` replaces it, on the head. The `LGP_LANES=4` run is after that commit and
stands.)

Shape of the four-lane run: eighteen of twenty parks are done at 89.6 s, and
the remaining 199 s is seed 428's two parks **running beside each other rather
than one behind the other** — which is the change. The verdict table is
unchanged from before the fix: 0 posts in the bus on every seed, control
non-zero on every seed (13–35 posts), 145.7 m of 145.7 m road swept.

## Status

- [x] worktree, install
- [x] located the regression commit from CI history (3d797f67)
- [x] local per-seed timings
- [x] root cause
- [x] control: seed 428 on `origin/feat/sphere-combined` — 10 s vs 185 s
- [x] fix (one queue, `LGP_LANES`/`cpus()`, per-park streaming, completeness guard)
- [x] `pnpm run check:entrance-road` green — **243 s on head `6cd4d7f4`** (14 lanes)
- [x] `LGP_LANES=4` run (CI-shaped), green, 288 s
- [x] PR #669 against `feat/procgen-on-sphere`
- [x] **`Entrance road` CI: PASS, sweep 11m53s** (run `35362790212`, head
      `6cd4d7f4`), was `cancelled` at 14m56s on `ae20b9fc`

## The CI proof — run `35362790212`, on head `6cd4d7f4`

**Read the commit before you read the numbers.** An earlier version of this
file quoted run `35361203366` — which is on `5d59f323`, *superseded by the very
handoff commits that recorded the measurement*. Exactly CLAUDE.md's "a
measurement goes stale" trap, with the extra sting that writing the note is
what staled it. **Every number below is off the head being merged.** If you
push to this branch, re-read them off the new run.

Sweep step 15:30:27 → 15:42:20 = **11m53s (713.1 s)** against the 900 s cap.

```
check:entrance-road: 20 parks (10 seeds x real/control), 4 at a time on 4 cpu(s)
  [17/20] seed      451 real    built in  14.6 s (226.4 s elapsed)
  [18/20] seed      451 control built in  12.5 s (230.3 s elapsed)
  [19/20] seed      428 control built in 501.7 s (711.5 s elapsed)
  [20/20] seed      428 real    built in 505.0 s (713.1 s elapsed)
entrance road OK — ... all 10 pool seeds; the tightest anywhere is 6.05 m (seed 24)
```

A CI core is ~2.7× this Mac (428: 505.0 s there, 185 s here).

## Headroom: a scheduling lever REMAINS, and it is a large one

Derived from that run's own per-park lines:

| | |
|---|---|
| total CPU over the 20 parks | **1881.3 s** |
| four-core lower bound (CPU / 4) | **470.3 s** |
| longest single park (seed 428 real) | **505.0 s** |
| **achieved wall clock** | **713.1 s** |
| cap | 900 s |
| **margin** | **187 s — 3m07s** |

**713.1 s achieved against a 505.0 s longest-park floor is 208 s of pure
scheduling loss** — nearly a third of the wall clock still sitting in the
scheduler.

**An earlier version of this section said the opposite, and it was wrong.** It
compared the two *lower* bounds (470.3 s and 505.0 s) to each other, observed
they had converged, and concluded "no amount of further scheduling buys
anything". Neither bound was ever compared to what was actually *achieved*, and
that gap is the entire question. Do not inherit that sentence.

The cause is in the run. Seed 428's two jobs **start at 208.1 s and 209.8 s**,
because `PARK_SEED_POOL` puts 428 ninth of ten, so its pair sits at queue
positions 17 and 18 behind nineteen cheaper parks on four lanes — the longest
job dispatched last, the classic tail. Dispatching longest-first would land it
at about 505–525 s and take the margin from 3m07s to roughly **6m30s**.

**Deliberately not done in this PR**: the queue has no cost hint to sort on,
and inventing one is a number somebody then has to maintain. Filed as its own
issue by the Overseer.

Two sensitivities, because they are easy to conflate:

- **the runner, or everything, ~26% slower** (900 / 713.1 = 1.26) times this
  out;
- **seed 428 alone ~37% slower** times it out — its jobs start at ~208 s
  whatever they cost, so 208 + 505 × 1.37 ≈ 900.

Either way the margin is about one slow seed wide. The lever that closes it for
good is the solver.

## Nothing was weakened — the reviewer's control

Both scripts run over all twenty parks in one worktree: base `727.09s user /
7:20.84 total` against this branch's `734.80s user / 3:56.91 total`, stdout
verdict **byte-identical**. **User CPU within noise is the decisive number** —
identical total work, so no seed skipped and no threshold relaxed; the 1.86× is
purely arrangement.

## The other red checks on this PR are the base's, byte for byte

Compared against PR #667's runs on `ae20b9fc`, from CI on both heads:

- **Procgen invariants**: 16 distinct failing test names on each,
  **identical sets** — none added, none fixed. (5 test files failed, 17
  passed, on both.)
- **Checks**: `check:slide-rider FAILED` on both, and nothing else.
- **Coplanar faces / Every seed builds**: red on the base too; `Every seed
  builds` is the sibling engineer's slice and shares this root cause.

`Entrance road` is the only one this PR moves, and it moves it from red to
green.

## The `LGP_LANES=4` run — the CI-shaped one

A four-vCPU runner is what the workflow gets, so the honest local shape is four
lanes:

```
LANES4 rc=0 elapsed=288s
  [17/20] seed      451 real    built in 4.8 s (89.0 s elapsed)
  [18/20] seed      451 control built in 4.8 s (89.6 s elapsed)
  [19/20] seed      428 real    built in 203.3 s (287.2 s elapsed)
  [20/20] seed      428 control built in 203.3 s (287.5 s elapsed)
entrance road OK — ... all 10 pool seeds; the tightest anywhere is 6.05 m (seed 24)
```

**Eighteen of twenty parks are finished at 89.6 s.** The other 199 s is the two
seed-428 parks, and they now run *beside* each other rather than one behind the
other — which is the whole change. The wall clock is one seed-428 park, where
before it was two.

**This four-lane local run is a good predictor and worth keeping as one**:
288 s × the ~2.5 core ratio = ~720 s, against the 713.1 s CI actually measured.
(An earlier note here projected "~8 minutes" from the same run — arithmetic
error, not a bad proxy. The measured figure is **11m53s**; see the headroom
section above, which is the one to read.)

## Two things a successor should not re-derive

- **`scripts/` is deliberately outside every tsconfig project** (see the
  comment in `tsconfig.test.json`), and there is no `@types/node` installed, so
  `tsc --noEmit` passing says **nothing** about this file. Tried and proved: a
  scratch project over the script bailed with `TS2688: Cannot find type
  definition file for 'node'`, and an appended `const x: number = "no"` went
  **unreported** — a typecheck that could not fail. The proof for a change here
  is running it.
- The `--control` second park (`setEntranceCorridorHonoured(false)`) is **not a
  gate** — the check says so itself, and prints "ASSERTS NOTHING" when the
  clause is inert, which it is on all ten pool seeds today. Dropping it would
  halve the check's total CPU, but it would **not** shorten the wall clock,
  because the critical path is a single seed-428 park either way. So it stays:
  removing a measurement that costs nothing on the clock buys nothing.
