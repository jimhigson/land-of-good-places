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

## Sweep (see PR body for the full table)

`M = 1` is the baseline (0.0% by construction) and **fails the fountain on every
seed**, so the instrument can go red. `M = 2` still fails the fountain.
`M = 2.5` is the first candidate that passes the fountain on all five seeds,
at a worst kerb detour of **68.2%** against the 73% ceiling.

## Status

- [x] Worktree, deps, instrument written and committed
- [ ] Full sweep finished
- [ ] Constant chosen and its derivation written onto it
- [ ] `pnpm run check` / `build` / `test:procgen` 497
- [ ] Browser QA on 5539
- [ ] PR
