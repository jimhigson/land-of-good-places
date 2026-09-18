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

## Status

- [x] worktree, install
- [x] located the regression commit from CI history (3d797f67)
- [x] local per-seed timings
- [x] root cause
- [ ] control: seed 428 on `origin/feat/sphere-combined` (pre-backtracking)
- [ ] fix
- [ ] proofs
