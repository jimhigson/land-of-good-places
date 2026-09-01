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

## Two environments, and they do not agree

**Main-only instrument** (`sweep-hop-multiplier.mts`, worst of 344 probes over
the five CI seeds, ratio against `M = 1`): fountain fails at every `M <= 2.1`
and passes from `2.2` up. Kerb detour steps up in plateaus —
`43.7%` at 2.1–2.4, `68.2%` at 2.5–3, `114.3%` at 3.5–4, `118.7%` at 6.4.

**The environment the 73% ceiling actually lives in** — a throwaway worktree
`.claude/worktrees/hop-measure` (branch `tmp/hop-measure`), which is
`feat/prefer-walking-on-paths` with #452 cherry-picked and the previous agent's
`lineCost` reconciliation reproduced. **It reproduces their numbers exactly**:
canonical `183.9%` worst, `+0.21 m` mean, probe `(14, 14) 4.1 m off`, mean paved
`83.3%`; seed 24 `202.4%`. So it is the same measurement, not a lookalike.

And in that environment the worst case is **not monotone in M**:

| M | canonical worst kerb |
|---|---|
| 2 | 47.8% ok |
| 2.5 | 52.4% ok |
| 3 | **120.5% FAIL** |
| 3.5 | 12.5% ok |
| 4 | 12.5% ok |
| 6.4 | **183.9% FAIL** |

That is the crux. The assertion is a **worst-of-105** over routes that change
topology discontinuously as the price of a crossing moves, so a value chosen by
"sweep until it passes" is green by the luck of one probe, not by a property of
the number. Denser sweep running; verify determinism by re-running 3 and 3.5
before believing the shape.

**Throwaway worktree housekeeping:** `rerere.enabled` was set to `false`
repo-wide so the cherry-pick's resolution could not be replayed into the real
merge (CLAUDE.md's rerere hazard). **It must be set back to `true`.**

## Status

- [x] Worktree, deps, instrument written and committed
- [x] Full sweep finished on main; branch-env sweep running
- [ ] Constant chosen and its derivation written onto it
- [ ] `pnpm run check` / `build` / `test:procgen` 497
- [ ] Browser QA on 5539
- [ ] PR
