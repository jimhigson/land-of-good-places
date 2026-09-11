# HANDOFF — #606, `check:park-boot` charges wall clock to a work budget

- **Branch**: `fix/park-boot-606`, worktree `.claude/worktrees/park-boot-606`
- **Model**: Opus 5 (1M context), chosen by the Overseer's brief (Engineer default).
- **Role**: Engineer. Reports to the Overseer. Does not merge.
- **Invisible to a player** — merges on review + QA, no preview link.

## What was wrong

Every ceiling in `scripts/check-park-boot.mts` compared a **wall clock** against
a budget for **generator work**. Those agree only on an idle box: a contended
box deschedules one slice for tens of milliseconds rather than running
uniformly slower, so the check failed 3 runs in 6 on a loaded laptop and passed
6 in 6 on a quiet one, on identical commits.

## What it does now

- `busyMsOf(wall, cpu) = min(wall, cpu)` — the part of a span the process can
  be **shown** to have computed. Applied to all four ceilings (rolling advance,
  overrun advance, event-loop block, unbudgeted generation) and to the box
  calibration loop.
- The clock is **`process.threadCpuUsage()`**, not `process.cpuUsage()`. The
  latter is process-wide; V8's concurrent marker got charged to
  allocation-heavy slices and invented a `pathGraph` fat unit (1 breach of 9
  slices, every run of 3, worst 33.9 ms). Thread CPU: zero breaches, same box.
- **The instrument is controlled before use**, on three properties, none of
  them a ratio against wall clock (a wall-clock ratio made the control itself
  fail on a loaded box): scales with work; stops when the thread sleeps; is the
  thread's clock, not the process's. Fail any → attestation dropped, ceilings
  back to raw wall clock, loud stderr note.
- **A breach must be corroborated**: two or more slices of the same task over
  the ceiling. A lone breach is reported on stderr, naming the task.
- **Worst-slice attribution reads every scheduler task**
  (`ParkGeneration.sliceCountsByTask`, added in `src/boot/parkGeneration.ts`),
  not the five phases carrying floors. That is why #606 saw "no generator step
  at all, 0 work units" — the work was in `pathGraph`, which the driver could
  not see. It was never descheduling in those three slices.
- **Coverage note on `process.stderr` every run**, saying what is not
  prosecuted and why.

## Proof (all on a laptop carrying four other agents; full transcripts are in the file)

| mutation | result |
|---|---|
| fixed 20M-iteration burn per `brief` unit | **exit 1**, `151 slices of "brief" ... worst 91.6 ms busy vs 28.6 ms ceiling` |
| one 40 ms `Atomics.wait` in a `brief` unit | **exit 0** + cleared-span notes; the **pre-#606 file on the same mutated tree: exit 1, twice** |
| `cpuMs` fed `process.cpuUsage()` | control rejects by name; with the fat unit also in, still **exit 1** on wall clock |
| unmutated, 6 consecutive runs | 6/6 green, 0 lone breaches, worst 12.2–21.7 ms vs ceilings 20.0–26.4 ms |

## Open finding, not fixed here

`pathGraph` is the tightest task in the run — worst slice 17.9–24.9 ms busy
against ceilings of 20–28 ms, where every other task sits under 16 ms. It does
not breach, but it has the least headroom of anything in the boot, and #608
(building the nav lattice in slices during boot) lands next door. Worth an
issue if it ever starts producing the lone-breach stderr line run after run —
which is precisely what that line is there to tell you.

## Not in scope

#608 itself. Untouched.
