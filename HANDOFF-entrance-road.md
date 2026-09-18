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

The irreducible critical path afterwards is one seed-428 park build. Reducing
*that* means changing how the driver answers a `pathGraph` refusal (the cheap
decision is a different `crossings` decision — prove a site at the fouled rail
distance — rather than re-rolling the whole railway), which is solver work that
belongs with the backtracking/every-seed-builds engineer, not here.

## The control on the measurement

Seed 428 built through the **same script** on `origin/feat/sphere-combined`
(the base this branch forked from, worktree
`.claude/worktrees/entrance-road-base`, detached at `5c322a5b`):

```
BASE seed=428 rc=0 elapsed=10s      # vs 185 s on this branch — 18.5x
```

So seed 428 is not an inherently expensive park; it is one that the new driver
solves the railway for five times instead of once.

## Proofs

`pnpm run check:entrance-road` on `fix/entrance-road`, quoted off the screen:

```
FULL rc=0 elapsed=221s        # 14 lanes on 14 cpus (this Mac)
entrance road OK — the bus's swept body clears every trestle post along the
whole 145.7 m road on all 10 pool seeds; the tightest anywhere is 6.05 m (seed 24)
```

Per-park lines from that run (the new streaming output), all twenty:

```
  [ 1/20] seed      131 control built in 13.7 s (13.7 s elapsed)
  ...
  [17/20] seed      274 control built in 46.3 s (46.3 s elapsed)
  [18/20] seed      274 real    built in 46.6 s (46.7 s elapsed)
  [19,20/20] seed  428 real + control — together, not one behind the other
```

Eighteen of twenty parks are done at 47 s; the whole wall clock is one seed-428
park, which is exactly the intended shape. The verdict table is unchanged from
before the fix: 0 posts in the bus on every seed, control non-zero on every
seed (13–35 posts), 145.7 m of 145.7 m road swept.

## Status

- [x] worktree, install
- [x] located the regression commit from CI history (3d797f67)
- [x] local per-seed timings
- [x] root cause
- [x] control: seed 428 on `origin/feat/sphere-combined` — 10 s vs 185 s
- [x] fix (one queue, `LGP_LANES`/`cpus()`, per-park streaming, completeness guard)
- [x] `pnpm run check:entrance-road` green, 221 s
- [x] `LGP_LANES=4` run (CI-shaped), green, 288 s
- [x] PR #669 against `feat/procgen-on-sphere`
- [x] **`Entrance road` CI: PASS, 11m22s** (run 35361203366), was `cancelled` at 15m15s

## The CI proof (run 35361203366, head of `fix/entrance-road`)

Step "Entrance road sweep" 15:14:56 → 15:25:51 = **10m55s** against the
15-minute cap. On `ae20b9fc` the same step was killed at 14m56s.

```
check:entrance-road: 20 parks (10 seeds x real/control), 4 at a time on 4 cpu(s)
  [17/20] seed      451 real    built in  15.2 s (233.6 s elapsed)
  [18/20] seed      451 control built in  14.9 s (234.0 s elapsed)
  [19/20] seed      428 real    built in 438.6 s (653.2 s elapsed)
  [20/20] seed      428 control built in 436.4 s (654.5 s elapsed)
entrance road OK — ... all 10 pool seeds; the tightest anywhere is 6.05 m (seed 24)
```

A CI core is 2.4× this Mac (428: 438.6 s there, 185 s here). **Eighteen of the
twenty parks are finished at 234 s; the remaining 420 s is one seed-428 park.**

**Read the headroom honestly.** Total CPU across the twenty parks is ~1776 s;
over four cores that floor is ~444 s, and the longest single park is 439 s — the
two bounds have met, so **no amount of further scheduling buys anything**. The
only lever left is making seed 428 cheaper, i.e. the solver. At 10m55s of a 15
min cap the margin is about one slow seed wide: a second 428-like seed entering
the pool, or 428 getting 35% worse, times this out again.

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

On a CI core that is roughly 2.5× slower this projects to ~8 minutes against
the 15-minute cap, from ~15 minutes before. **Say plainly that the margin is
one slow seed wide**: the check is now honest and inside its budget, but the
thing actually making it expensive is the solver, and until seed 428 stops
costing five railway solves this workflow sits at about half its cap.

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
