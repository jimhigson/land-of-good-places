# HANDOFF — the hop penalty's comic detour

Branch `fix/hop-penalty-detour`, worktree `.claude/worktrees/hop-detour`, port **5539**.

PR #452 gave hoppable walls `HOP_COST_MULTIPLIER = 6.4` in `src/world/NavGrid.ts`.
That is the right *shape* — the fountain stays enterable and routes do not paddle
through it — but it makes the router take a long way round to reach a spot a few
metres off the kerb, which is Jim's own named failure mode.

## The instrument

The check that saw it (`check:path-preference`) lives only on
`feat/prefer-walking-on-paths`. Rather than reproduce that branch's 12-hunk
reconciliation, the same **probe geometry** is rebuilt on main:

- `scripts/measure-kerb-detour.mts` — destination 2–6 m off the paving, walked to
  from the nearest point on `pathCentreline()`. Prints one `KERB` line per probe.
- `scripts/sweep-hop-multiplier.mts` — edits the constant in place, runs the real
  scripts, restores the file. Baseline is `M = 1` (the router before #452), which
  is the honest "direct" comparator for the thing being changed.

Both constraints are measured, never argued: kerb detour on all five CI seeds,
and `check:fountain-hop` on all five CI seeds.

## The seed list was wrong, and it was hiding the floor

`check-fountain-hop.mts` and `measure-hop-detours.mts` both swept
`[PARK_SEED, 2, 5, 11, 18]` and called it "the five seeds CI builds a park on".
It is not: **#429 retired seed 2** (it proves zero bridge sites) and put **24**
in its place — `test/procgen/` is the owner. Corrected in both files.

This is load-bearing, not tidying: **seed 24 is the seed that binds the fountain
hardest.** Its fountain goes red at `M = 2.3` while all four of the old list's
seeds are still green there, so the check that exists to defend the fountain
could not see its own floor. It passes on 24 at today's `6.4`, so the
correction changes no verdict on main today.

## Two environments, both measured

**Main** (`sweep-hop-multiplier.mts`; worst of 342 kerb probes over the
corrected five seeds, ratio against `M = 1`; fountain via `check:fountain-hop`).
Monotone and well behaved: fountain red at `<= 2.3`, green from `2.4`; kerb
`43.7%` at 2.2–2.5, `68.2%` at 2.6–3.1, `94.7%` at 3.2, `114.3%` at 3.3+.

**The environment the 73% ceiling actually lives in** — throwaway worktree
`.claude/worktrees/hop-measure` (branch `tmp/hop-measure`):
`feat/prefer-walking-on-paths` + #452 cherry-picked, with the previous agent's
`lineCost` reconciliation reproduced. **It reproduces their numbers exactly** —
canonical `183.9%`, `+0.21 m`, probe `(14, 14) 4.1 m off`, mean paved `83.3%`;
seed 24 `202.4%` — so it is the same measurement, not a lookalike.

Worst kerb detour per seed, ceiling 73%:

| M | canon | 5 | 11 | 18 | 24 | fountain |
|---|---|---|---|---|---|---|
| 2.2 | 12.5 | 21.3 | 6.1 | 37.9 | 7.6 | **red (24)** |
| 2.3 | 12.5 | 21.3 | 6.1 | 34.2 | 7.6 | **red (24)** |
| **2.4** | 12.5 | 21.3 | 6.1 | 34.2 | 7.6 | **ok** |
| 2.5 | 52.4 | 21.3 | 6.1 | **85.7** | 7.6 | ok |
| **2.6** | 12.5 | 21.3 | 6.1 | 19.6 | 7.6 | **ok** |
| 2.8 | **120.5** | 21.3 | 6.1 | 32.1 | 7.6 | ok |
| 3 | **120.5** | 21.3 | 6.1 | 19.6 | 43.8 | ok |
| 3.2 | **120.5** | 21.3 | **104.2** | 37.4 | 43.8 | ok |
| 3.5 | 12.5 | 21.3 | **104.2** | 37.4 | 43.8 | ok |
| 4 | 12.5 | **98.7** | **97.3** | 69.4 | 7.6 | ok |
| 5 | 12.5 | 21.3 | **118.7** | 37.3 | 7.6 | ok |
| 6.4 | **183.9** | 21.3 | 6.1 | 37.3 | **202.4** | ok |

**It is deterministic** — 2.8 re-run gave 120.5% to the decimal — so the
non-monotonicity is real router behaviour, not noise: the assertion is a
worst-of-105 over routes whose topology flips as the price of a crossing moves.

**A value does exist: 2.4 and 2.6 are green everywhere in both environments**,
and 2.5 between them is not (seed 18, 85.7%). Mapping the width of the 2.6
plateau now; a value picked off a knife edge is not a fix, whatever it scores.

## Status

- [x] Worktree, deps, instrument written and committed
- [x] Full sweep finished on main; branch-env sweep running
- [ ] Constant chosen and its derivation written onto it
- [ ] `pnpm run check` / `build` / `test:procgen` 497
- [ ] Browser QA on 5539
- [ ] PR
