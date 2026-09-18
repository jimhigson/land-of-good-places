# Handoff — chain reds (`check:park-boot`, `check:layout-rung`, `check:arrival-camera`, `check:solve-cost`)

**Model: Opus 5 (1M context)**, chosen by the Overseer's Engineer default. A
replacement runs the same model (CLAUDE.md, "A replacement runs the same model
as the agent it replaces").

Branch `fix/chain-reds`, worktree `.claude/worktrees/chain-reds`, based on
`origin/feat/procgen-on-sphere` at **86f9a513** (two commits past the
`ae20b9fc` the brief named: `78d25b40` check:entrance-road, `86f9a513`
check:waypoints/#674). PR against `feat/procgen-on-sphere`. Do not merge.

Probe worktree `.claude/worktrees/chain-reds-probe` is a detached checkout of
`origin/fix/ride-scale-tdz` (PR #682), used as a control. **Remove it when
done.** `scripts/_probe-plan-steps.mts` is an untracked probe — do not commit.

## Triage — the four were never four defects

| check | on 86f9a513 | now | owner |
|---|---|---|---|
| `check:arrival-camera` | red, `RIDE_SCALE` TDZ | green behind #682 | **not mine — #682** |
| `check:layout-rung` | red, 5 failures | **fixed** | mine |
| `check:solve-cost` | flaky (wall-clock) | **fixed** | mine |
| `check:park-boot` | **green 4/4 here** | green, latent | mine — see below |

## 1. `check:arrival-camera` — belongs to #682, no residue of my own

Same `hazards.ts:171` TDZ as `check:cart-shape` / `check:ground-claims`. One
cause, three checks. **Proved it is the whole story**, which is the part worth
having: on the probe worktree (`origin/fix/ride-scale-tdz`, 06085e08)
`pnpm run check:arrival-camera` exits **0** with `PASS: 28 checks`, every
number real. Nothing on this branch is needed for it. Do not duplicate.

## 2. `check:layout-rung` — fixed (commit "force the layout decision…")

The geometry half always passed. The *machinery* half scored zero on
everything, and all five reported failures came from that one dead probe.

**Root cause — the check's driver, not the ladder.** The child it spawns ran
`await import("./src/world/parkLayout.ts")`. Under backtracking `PARK_LAYOUT`
is a `lazyView` over `planPart('layout')`, so importing decides nothing: the
child printed one line and exited, `LGP_LAYOUT_REFUSE=hotel:40` injected
nothing, and the hook, both rungs and decision zero were **entirely intact**
all along. (The Overseer's relayed guess that the hook "no longer exists in
that shape" is wrong — it is alive at `parkLayout.ts:781`.)

**Fix.** The child now reads the view (`m.PARK_LAYOUT.entries.size`), which
drives the real solve — the layout's own rungs inside `layoutRestartSearch`,
and decision zero as `parkPlan.ts`'s driver drawing the next restart. Plus an
**absence guard**: an empty/note-only trace is now its own named failure, so
four plausible zeroes can never again be scored off having measured nothing.

Also fixed alongside: `parkLayout.ts` emitted `cached — no solve ran in this
process` at *module scope*, which with a lazy view is unconditionally true at
that moment, so it printed on every run including ones that went on to solve.
Moved to process exit, where it says something.

**Green, quoted off the screen** (seed 20260728, 14 doormats,
`ARRIVAL_EXEMPT_NEAR` 7 m, boundary door at z 91.8):

```
  control: 14 doormats on seed 20260728, 0 refusal(s)
  a door 20 m outside the boundary at (0, 91.8): poi.nospot, blockers=[], non-plot=[boundary]
  four walls ringing the hotel doormat with faces 12 m out: poi.stranded, blockers=[ring-n,ring-s,ring-e,ring-w]
  a 3 m plot on the hotel doormat (inside the 7 m arrival exemption): 0 refusal(s)
  machinery (LGP_LAYOUT_REFUSE=hotel:40, seed 20260728): 81 trace line(s), 40 refusal(s), 22 rung-1 redraw(s), 17 rung-2 redraw(s), 1 decision zero(s), 2 restart(s) [0,1], solved=1
check:layout-rung OK — the doormat rung refuses on geometry, names its blockers, and unwinds.
```

**Proved red three ways, all on that same geometry**, and each distinguishable
from the others — which is the point, since the old failure mode was four
identical zeroes:

- **A — revert the child to a bare `import()` (the original rot).**
  `1 trace line(s), 0 refusal(s), 0/0/0, 0 restart(s) [], solved=0`; **6
  failures**, the first being the new guard naming the real cause.
- **B — `forcedRefusal()` returns `null` (hook disarmed, solve still forced).**
  `2 trace line(s), 0 refusal(s), 0/0/0, 1 restart(s) [0], solved=1`; **4
  failures**. Note `solved=1`: the guard correctly does *not* fire, because the
  solve genuinely ran and it was the injection that did nothing.
- **C — `redraw()` refuses on rung 1.** `81 trace line(s), 40 refusal(s), 0
  rung-1, 39 rung-2, 1 decision zero, restarts [0,1], solved=1`; **1 failure**,
  exactly the rung-1 clause.

## 3. `check:solve-cost` — fixed, root cause was the instrument

Every reading was `performance.now()` around a dynamic `import()` — wall clock,
which charges a descheduled process for time it did not compute in. Now gated
on `min(wall, threadCpuUsage)`.

**One owner, not a copy.** `check:park-boot` had already solved this (issue
#606) including the measured finding that it must be `process.threadCpuUsage()`
and not `process.cpuUsage()`. That instrument, its three controls and its prose
moved to **`scripts/lib/cpuClock.mts`**; both checks import it. `check:park-boot`
verified unchanged by running it (exit 0 — `scripts/` is in no tsconfig
project, so running is the only proof).

**Proved both directions by mutation, on the `layout` stage (budget 250 ms):**

| mutation | wall | attested CPU | verdict |
|---|---|---|---|
| 400 ms of pure `Atomics.wait` deschedule | **574.6 ms** | 101.1 ms | **green** |
| 400 ms of real arithmetic | 500.7 ms | **466.3 ms** | **red** |

The first *is* the old flake, reproduced at 2.3× the budget and no longer able
to redden the check; the second is a real regression still caught. Ordinary
run shows the gap live: `layout … [wall 137.1 ms, cpu 83.1 ms]`.

### Finding, NOT fixed — five of seven clauses cannot fail

Under backtracking nothing solves at module scope, so five stages now measure
module *parse* only:

```
cruiser   0.1 ms vs  6304 ms   (57,309x under)
train     0.1 ms vs 12000 ms  (150,000x under)
slide     0.0 ms vs 32560 ms  (757,209x under)
railRace  0.0 ms vs   250 ms    (5,556x under)
paths     0.0 ms vs  2744 ms   (60,978x under)
```

Only `boundary` (54–60 ms, a real `cachedSolve`) and `layout` (83–122 ms of
module-graph evaluation, against the coarse 250 ms floor — and it is the one
that flaked) read anything. Those five now **say so on stderr on every run**
with their real numbers. Re-deriving the budgets is a threshold decision and is
deliberately left un-taken: the work they used to measure now lives in the
driver, which `check:park-boot` gates per-slice and `parkPlan.ts` reports
per-feature (`time/pieces layout=64ms cruiser=3333ms train=7157ms slide=3305ms
crossings=12ms pathGraph=57ms road=0ms`). This is the reconciliation
`check-solve-cost.mts`'s own header has asked for since it was written.

## 4. `check:park-boot` — green, and says on every run that it should not be

Green on every run taken (6 so far, 18–22 s each). But most runs print the same
NOTE naming the same task:

| run | ceiling | worst slice | units | of slices |
|---|---|---|---|---|
| 1 | 20.0 ms | 22.8 ms busy / 22.9 ms wall | 21 | 1 of 1690 |
| 2 | 20.5 ms | 22.5 / 22.6 | 21 | 1 of 1656 |
| 3 | 20.1 ms | 23.1 / 23.1 | 21 | 1 of 1687 |
| 4 | 20.1 ms | 22.4 / 22.4 | 21 | 1 of 1674 |
| 5 (post-extraction) | ~20 | 18.1 busy | — | no note |

Always `parkPlan x21`, during **"joining up the paths"**. The check's own words:
*"If you see this line run after run, naming the same task, that is the check
telling you it IS the code."* Two breaching slices is a foul (#606), which is
very likely the red seen on `ae20b9fc`.

**Note the busy ≈ wall equality** — this is real computation, not contention,
so the CPU-time fix does not touch it.

**Mechanism, from reading `solveScheduler.advance`** (`src/boot/solveScheduler.ts`):
the loop checks `now() >= deadline` *after* each slice, so it can begin a unit
just under an 8 ms deadline and then run that unit to completion. 21 units in
22.8 ms is ~1.1 ms average, so the shape that fits is ~20 cheap units reaching
the deadline plus one fat final unit of ~14–15 ms. `advance`'s own doc comment
claims "the overrun counter is therefore 0 on correct code", while the run
reports `steps begun after their slice's deadline: 4 (parkPlan 4)`.

**Next step (not yet run — the chain was occupying the box):**
`scripts/_probe-plan-steps.mts` times every `next()` of the plan drive on
attested CPU and names the fattest, plus counts how many single steps exceed
the 8 ms budget and the 20 ms ceiling on their own. Run it, find the fat unit,
and slice it (add a `yield` inside it) — that is the cause; the ceiling is not
to be widened.

## State

- Committed and pushed: layout-rung fix, cpuClock extraction, solve-cost fix.
- Full `pnpm run check` running end to end — see below when it lands.
- Still to do: park-boot fat unit; `LGP_SEED=n check:park` sweep;
  `test:procgen` name-diff vs base; PR.
