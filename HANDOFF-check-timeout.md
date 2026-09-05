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

## Scope boundary (Overseer, 5 September)

**`entrance-road.yml` and pulling `check:entrance-road` out of the chain are
NOT this ticket.** The sphere-ground Engineer holds that file on the combined
branch and is porting the separation forward. This branch measures the chain
and makes a timeout announce itself; it does not move that step. The 6m13s
figure above is evidence about the cap, not a task.

## Note for whoever builds the announcement

Another agent measured this and it matters for where a budget line is printed:
on a **passing** Vitest run, `console.log` is **intercepted and invisible**,
while **both `process.stdout.write` and `process.stderr.write` are visible.**
The real distinction is `console.*` interception, **not** stdout-versus-stderr
— so CLAUDE.md's "write those notes to `process.stderr`" is right about the
symptom but names the wrong mechanism. A budget note must use
`process.*.write`, not `console.log`, or it will be invisible on exactly the
runs it exists for.

(The chain's own budget line runs in a shell step rather than under Vitest, so
this applies to any per-check coverage note, not to the workflow-level print.)

---

# Built: the watchdog (5 September)

Model: **Opus** (chosen by the Overseer for this ticket). Branch
`fix/check-chain-timeout`.

## What landed

- `scripts/checkChain.mts` — one owner for the two facts both tools need: the
  cap (**read out of `checks.yml`**, never copied) and how to name a step from
  a pnpm `$ <command>` line.
- `scripts/check-watchdog.mts` — runs the identical `pnpm run check` under a
  clock set `DEFAULT_MARGIN_SECONDS` (180) *inside* the job's cap. On firing:
  kills the chain, prints a block naming the step, exits **124**.
- `scripts/measure-check-chain.mts` — the per-step measurer, now sharing the
  owner above.
- `checks.yml`'s "Run the checks" step calls `pnpm run check:watchdog`.
  `timeout-minutes: 30` is unchanged, as the backstop.

**The `check` chain's contents are untouched** — parsed against `origin/main`,
59 steps both sides, empty set difference both ways.

## The control, and the real bug it caught

```
CHECK_WATCHDOG_BUDGET_SECONDS=20 pnpm run check:watchdog
```

```
=== CONTROL EXIT=124 (want 124) ===
check:watchdog — THE CHECK CHAIN RAN OUT OF CLOCK
  ran for            0m20s
  watchdog budget    0m20s
  checks.yml cap     30m00s
  steps completed    5
  killed during      measure-deck-fallthrough  (after 0m17s in it)
check:watchdog — chain took 0m20s of a 30m00s cap (1.1% used, 29m40s spare) across 5 steps.
```

**The control has two halves and the second is the one that mattered.** On the
first attempt the alarm fired and named the step perfectly — and the chain
**kept running for another three minutes**, advancing well past the step it had
supposedly been killed in. Nine node processes were still alive.

Cause: `pnpm run check` is a chain of `&&`-ed `pnpm run check:*`, so signalling
the direct child leaves every grandchild alive, and `close` never arrives while
they hold the stdio pipes. **On CI that watchdog would have been decorative** —
it would have printed its failure and then let the job run on to
`timeout-minutes` anyway, producing the very `cancelled` it exists to prevent.
It would have looked like a working solution in every log.

Fixed by spawning `detached: true` (own process group) and signalling the
**group** (`process.kill(-pid, …)`), plus a `SIGINT`/`SIGTERM` handler so the
watchdog takes the chain with it if it is killed itself. Second half of the
control now reads:

```
=== SECOND HALF OF THE CONTROL: did anything survive? ===
none — the whole chain died with the watchdog
```

**If you change the kill path, run both halves.** Exit 124 alone does not
prove the chain stopped.

## Still to do

- Full `pnpm run check:watchdog`, `test:procgen`, `build` — exit codes.
- Open the PR. It merges after review + QA without going to Jim (invisible
  to a player).
- **Report the table back once `check:entrance-road` leaves the chain** via
  the sphere-ground branch; if the chain is still above ~80% of cap after
  that, the top steps become their own ticket. `check:climb-wave` (5m37s,
  ~21%) wants a look at *why* it is slow, not a trim.

## There are THREE pre-push gates, and this watchdog covers one

`check`, `test:procgen`, **and `check:coplanar`**. The last two run in their own
workflows, with their own caps, and **the same silent-failure surface** — a
timeout in any of them is reported by GitHub as `cancelled`.

Measured on `main`, same method as the chain:

| workflow | cap | worst recent | % of cap | watchdog? |
|---|---|---|---|---|
| `checks.yml` | 30m | **26m23s** | **87.9%** | yes |
| `procgen-invariants.yml` | 15m | 9m59s | **66.6%** | no |
| `coplanar.yml` | 15m | 5m30s | 36.7% | no |

**`Procgen invariants` is the one to watch next.** Its own three runs span
1.67× (5m59s → 9m59s) — the same runner-speed effect — so at 66.6% it has the
identical exposure `checks.yml` has, one step behind. `Coplanar faces` is
comfortable (103 s on the combined branch, matching the fast end here).

Extending the watchdog is deliberately small: **`capSeconds()` already takes
the workflow path as a parameter** rather than hard-coding `checks.yml`, so a
second caller passes its own. Left out of this PR to keep one mechanism under
review rather than three.

**Reported, not acted on:** `check:coplanar` is documented as a required
pre-push gate (CLAUDE.md line 298), sits outside the `check` chain by design
(line 883), and its table row says "not yet — needs adding" as a required
status check (line 285) — documented, unenforced, and outside the chain. Three
workflows are now in that position. Branch protection is a repository setting;
the Overseer has it queued as an ask for Jim.
