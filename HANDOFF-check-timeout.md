# Handoff — the `Checks` job dies by the clock, not by an assertion

Branch `fix/check-chain-timeout`, worktree `.claude/worktrees/check-timeout`.
**Measurement done; fix not built yet** — the Overseer asked for the numbers
first, because the biggest single contributor may be about to disappear.

## The tool

```
gh run view <run-id> --log > run.log
pnpm run measure:check-chain run.log
```

`scripts/measure-check-chain.mts`. `checks.yml` runs all 59 steps as **one**
`run:` step, so GitHub's per-step timings are useless here — the UI shows one
step that took 26 minutes. pnpm echoes each script as `$ <command>` and the
runner timestamps every line, so differencing consecutive `$` lines gives each
script's wall clock. The cap is **read out of `checks.yml`**, not copied.

**Control, run on the instrument before believing it** (CLAUDE.md's rule, and
it earned its keep — see the two instrument bugs below). Pointed at the run
that genuinely was killed, PR #498's `33845796723`:

```
  job wall clock      30m12s
  headroom            -0m12s   100.7% of cap used
  *** OVER CAP — GitHub reports this as `cancelled`, not `failure` ***
```

It reports over-cap when over and under-cap when under, so its "87.6%" on a
green run means something.

**Two ways this instrument was wrong before it was right**, both the same
disease as everything else in this repo:

1. It printed the raw command truncated to 96 columns. Every entry starts with
   the same ~70 characters of `node --no-warnings --import ./scripts/…`, so
   `check-climb-wave.mts` came out as `check-climb-wav` and a grep for it
   matched nothing — I nearly concluded climb-wave was absent from three runs.
2. Naming the script by the *first* filename in the command line named all 59
   steps `ts-extension-resolver-register` — the loader, which every step
   shares. It reported one confident answer for everything.

## The measurement — `main`, four runs, per-script

| run | commit | job wall clock | % of 30m cap | headroom |
|---|---|---|---|---|
| 33913296811 | 61e95fe5 | **26m17s** | 87.6% | 3m43s |
| 33845182075 | 10fb7c2d | **26m20s** | 87.8% | 3m40s |
| 33827458872 | 3aa55407 | 25m47s | 85.9% | 4m13s |
| 33832461616 | c95facf6 | 16m37s | 55.4% | 13m23s |

Worst of the last eight runs on `main`: **26m23s, 87.9% of cap, 3m37s left.**

Where it goes (run 33913296811; the ordering is the same in all four):

| script | time | % of chain |
|---|---|---|
| `check:climb-wave` | **5m37s** | 21.6% |
| `check:fountain-hop` | 4m25s | 17.0% |
| `check:pet-slide` | 2m07s | 8.1% |
| `check:slide-rider` | 1m56s | 7.5% |
| `check:bus-journey` | 1m22s | 5.3% |

Top 5 = **53–61% of the chain** across the four runs. Checkout+install is only
**~20 s** — this is all script time.

**`check:climb-wave` is the largest single consumer in every run measured**
(20.1–21.6%), so the axe fell where the time actually is; that was worth
checking rather than assuming, and the assumption happened to be right.

## The finding that matters more than any single script

The 16m37s run is **not** a shorter chain. Every script scales by the same
factor against it:

```
33913296811  job x1.58 | climb-wave x1.64 | bus-journey x1.61
33845182075  job x1.58 | climb-wave x1.53 | bus-journey x1.65
33827458872  job x1.55 | climb-wave x1.49 | bus-journey x1.57
```

**That is runner speed, not workload: a 1.58x spread between the fastest and
slowest machine GitHub hands out.** So the 3m40s of headroom is not slack in a
stable system — it is slack in one whose wall clock swings by ±58% for reasons
nobody here controls.

Arithmetic that follows: **a runner only 14% slower than the ones producing
26m20s puts `main` over 30 minutes with no new steps at all** (30 / 26.33 =
1.139), and a 58% spread has been observed. The chain is already over budget
in expectation. #498 did not break it; it spent the last of the margin.

## What #498 actually cost

On the killed run, `check:entrance-road` was **6m13s — 20.8%, the single
largest step, bigger than climb-wave.** I had estimated 3–4 minutes by analogy
with `coplanar.yml`'s sixteen-park sweep; that estimate was wrong by 2x, and
the log is the reason to trust 6m13s over it. 26m20s + 6m13s ≈ 32.5m.

## `main` is NOT timing out today — say this accurately

Three `cancelled` `Checks` runs on `main` in two days look alarming and are
not: they lasted **58s, 2m13s and 14m52s**, i.e. superseded by a newer push
(`concurrency: cancel-in-progress`). Only PR #498's run died on the clock.
The hazard on `main` is the 12% margin, not a present failure.

## The proposal (NOT yet built — awaiting the Overseer)

1. **Make a timeout announce itself.** Today a clock-death and a pass differ
   only by reading a 2000-line log, because GitHub reports a timeout as
   `cancelled`. Wrap the chain in a **watchdog set below the job cap** — GNU
   `timeout` exits **124**, a genuine non-zero, so the job goes **red as a
   `failure`** with a message naming the step it died in, instead of grey and
   silent. Keep `timeout-minutes` above it as the backstop.
2. **Print the budget on every run**, pass or fail — elapsed against the cap
   and the percentage used, to `stderr`. CLAUDE.md's "when a check stops
   covering something it must say so on every run", applied to the clock: the
   margin should be visible *before* it is breached, not discovered after.
3. **Only then, the structural fix.** Raising `timeout-minutes` alone is the
   tempting answer and is wrong on its own: it buys time without telling
   anyone the chain is growing, which is how it got here. The real options are
   splitting the chain across jobs (the `coplanar.yml` / `procgen-invariants.yml`
   shape, already the house pattern for exactly this) or making the top two
   scripts cheaper. **Do not optimise `check:entrance-road`** — the
   sphere-ground branch is expected to delete the corridor clause that made it
   necessary, so it may vanish entirely.

## Rules observed

- Ran the staleness guard **before** touching anything:
  `git merge-base --is-ancestor origin/main HEAD` → yes. (This is the guard
  whose absence cost 71 commits on `fix/road-487-488` earlier today.)
- `package.json`'s `check` chain is **untouched** — `measure:check-chain` is a
  standalone script. Verified by **parsing** the scripts object against
  `origin/main`: 59 steps both sides, empty set difference both ways.
- No `git stash`.
