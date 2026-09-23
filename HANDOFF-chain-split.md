# HANDOFF — chain-split (Checks sharding + #693)

Branch `fix/chain-split`, worktree `.claude/worktrees/chain-split`, PR target `feat/procgen-on-sphere`.

## Decisions
- Shards live in package.json as `check:shard-N` && chains; `check` = `pnpm run check:shard-1 && ... && check:shard-N`
  (contiguous, original order kept, so local `pnpm run check` runs the identical sequence).
- checks.yml: matrix job runs `pnpm run check:watchdog check:shard-${{ matrix.shard }}`; separate build job;
  aggregator job `name: Checks` with `if: always()` needs all, fails unless every result == success
  (a skipped required check counts as passing — that is why always()).
- Branch protection on main requires contexts "Checks" (app 15368 = Actions) and "Procgen invariants". No settings change needed.
- check:chain-coverage extended: matrix expansion of workflow `pnpm run` lines, partition assertions (exactly once, every shard run by CI).

## Measurements
Per-step CI durations extracted with scratch `durations.mjs` from runs 35395150479, 35409216254, 35426375391, 35435207534,
35435253631 (sphere, all killed/failed before the end) and main 34597454421/34782626045/35156469040 for the tail.

## Status (checkpoint 1)
- Done + pushed: 7 contiguous shards in package.json; checks.yml matrix + build job + aggregator `Checks`;
  job-scoped caps in scripts/checkChain.mts (`capSeconds(wf, jobId)`, `workflowJobs`); watchdog takes `--job`;
  chain-coverage matrix expansion + partition assertions. Controls A-D all red, restored green.
- Old chain vs shard union: 68 = 68, identical order (proved with old package.json from origin/feat/procgen-on-sphere).
- Next: open PR, read shard durations, rebalance; throwaway failing-shard commit to prove aggregator; orphans (#693).
