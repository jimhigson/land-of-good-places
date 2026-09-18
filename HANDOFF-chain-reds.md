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

## 3. `check:solve-cost` — REWRITTEN; five of seven rows could not fail

Two faults, not one. The flake was the smaller of them.

**Fault A — the rows measured a module parse.** They timed a dynamic `import()`
of each solver module, on the premise that importing solved it. Under
backtracking every plan is a `lazyView` over `parkPlan.ts`'s driver, so
importing decides nothing. Measured before the rewrite:

```
cruiser   0.1 ms vs  6304 ms   (57,309x under)
train     0.1 ms vs 12000 ms  (150,000x under)
slide     0.0 ms vs 32560 ms  (757,209x under)
railRace  0.0 ms vs   250 ms    (5,556x under)
paths     0.0 ms vs  2744 ms   (60,978x under)
```

A reviewer's independent proof of the cost: a slide regression from **3206 ms
to 16641 ms**, pieces 597k → 3,008k, whole park build 15.1 s → 29.9 s, reported
`ok`.

**Fault B — wall clock.** `layout` read 90 / 96.1 / 96.6 / 97.4 / 98.0 / 99.3 /
102.2 / 110 / 117 / 216.5 / 260.3 / 275.1 ms against a 250 ms budget across two
agents, the reds at load average 14.82.

### The rewrite

Rows now read **`parkSolveStats().cpuMsByFeature`** after forcing a real solve:
the driver times its own features as it runs them and the check only asserts.
`ParkSolve` gains `cpuMsByFeature` beside `msByFeature`, on
`process.threadCpuUsage()` (0 in a browser — no such clock, nothing reads it).
`scripts/lib/cpuClock.mts` is the checks' shared owner of that reading,
extracted from `check-park-boot.mts` rather than copied.

**Best-of-N was considered and rejected** — sound reasoning (contention only
adds time) but redundant once the clock ignores contention, and it would cost N
full park solves.

**Multiplier cut 8x → 3x**, which is the dividend of gating on CPU: the old 8x
absorbed CI hardware (~2-3x) *and* parallel load (~2x), and contention no
longer reaches the reading. This matters — 8 x 3305 = 26440 ms would have waved
the 16641 ms slide regression straight through.

**Budgets re-derived**, median of three quiet-box runs, all three readings kept
in the file beside each row:

| feature | runs (ms CPU) | median | budget (3x, floor 250) |
|---|---|---|---|
| boundary | 45.0 / 45.3 / 46.9 | 45 | 250 |
| layout | 58.2 / 56.6 / 62.0 | 58 | 250 |
| cruiser | 3021.9 / 3070.2 / 3102.5 | 3070 | 9210 |
| train | 6652.0 / 6926.1 / 7570.5 | 6926 | 20778 |
| slide | 3180.4 / 3196.5 / 3604.8 | 3197 | 9591 |
| crossings | 11.5 / 11.3 / 10.4 | 11 | 250 |
| pathGraph | 53.9 / 54.0 / 67.8 | 54 | 250 |
| road | 0.4 / 0.4 / 0.5 | 1 | 250 |

Green run, real numbers: `13283 ms of CPU over 7 features, 14 turns`.

### Proved red — every row, four ways

1. **Every row armed** (multiplier 0.5, floor 1): **7 of 8 OVER**. `road` stayed
   ok at 0.5 ms — it genuinely costs 0.4 ms, so only real work can arm it:
2. **Real work, production budgets.** `LGP_BURN=road:400` → road **801.4 ms vs
   250 ms, OVER**. All eight rows now proved armed.
3. **The real regression class.** `LGP_BURN=slide:6700` → slide **17966.9 ms vs
   9591 ms, OVER** — the 3206→16641 ms regression reproduced and caught.
4. **The instrument.** `cpuNow()` → 0: the control fires — *"0 feature(s) above
   zero, 0.0 ms in total, over 7 increment(s)... Every budget below would pass
   on an absence"*. And a budgeted feature renamed to `roadway` → *"never run by
   the driver and so were never priced"*.

(`LGP_BURN` was a temporary mutation in `parkSolve.ts`, reverted — it is not in
the branch. Re-create it by burning CPU for a named builder inside `turn()`.)

## 4. `check:park-boot` — the recurring over-ceiling slice, FIXED

Green throughout, but it named the same slice on 4 of 4 runs: `parkPlan x21`,
21 work units, **22.4-23.1 ms** of attested busy against a ~20 ms ceiling,
during "joining up the paths". Busy ≈ wall, so real computation, not
contention. The check's own words: *"If you see this line run after run, naming
the same task, that is the check telling you it IS the code."*

**Measured, not guessed.** `scripts/_probe-plan-steps.mts` (untracked) times
every step of the plan drive on attested CPU. The whole overrun was **one
step** — and the *last* step of the drive:

```
step 1672422     15.57 ms busy (15.59 ms wall)  after 5 feature(s) placed, latest=pathGraph
```

Everything after `yield* pathGraphSearch()` in `parkPlan.ts`'s pathGraph
builder ran unbroken: `drawnSamplesFor`, the boundary `find`, the off-site
crossing screen, the lane-pinch check — four independent passes over the same
samples in a single `next()`. `solveScheduler.advance` checks its deadline
*after* each unit, so a slice beginning that step just under its 8 ms budget
runs to 8 + 15.57 ms = the 22.5 ms reported.

**Fix:** four passes, four pieces (three added `yield 0`).

| | before | after |
|---|---|---|
| fattest pathGraph step | 15.57 ms | 10.77 ms |
| worst slice | `x21`, 21 units, 22.4-23.1 ms | `x778`, 778 units, 19.3-20.4 ms |
| over-ceiling note | 4 of 4 runs | 1 of 3 runs |

The worst slice is no longer a fat unit at all — it is 778 cheap units filling
a budget, which is what a well-sliced generator looks like.

**No decision change:** `check:park` canonical is **245/245 waypoints, 19/19
attractions, all six invariants** — unchanged; plan pieces move by exactly the
four yields (1672427 → 1672431).

**Residue for whoever picks this up:** 9 single steps still exceed the 8 ms
budget on their own (a cluster of 8-11 ms steps in `train`, one 11 ms step
before any feature is placed). None exceeds the 20 ms ceiling alone, so none is
prosecutable today, but each is a slice overrun waiting for the wrong deadline.
Same probe, same fix shape.

## Verification still outstanding

- Full `pnpm run check` end to end on the final tree. One run was started and
  **killed deliberately** — I was still editing the tree under it, so it was
  measuring a moving target. It had reached step ~23 (`check:speech-bubbles`)
  green. Must be re-run.
- `LGP_SEED=n pnpm run check:park` sweep.
- `test:procgen` name-diff against base (base has 55 failures).
- PR against `feat/procgen-on-sphere`.

## Housekeeping

- `package.json` **not touched** — verified by parsing, not grep: step sets
  identical to base (67 vs 67, none added, none removed).
- Remove the probe worktree `.claude/worktrees/chain-reds-probe`.
- `scripts/_probe-plan-steps.mts` is untracked on purpose — do not commit.
