# HANDOFF — is `check:pet-slide` still flaky after #508?

Model: **Claude Opus 5 (1M context)**. Role: Engineer. Branch
`fix/pet-slide-flake`, worktree `.claude/worktrees/pet-slide-flake`, based on
`origin/main` `10fb7c2d`.

All measurements on Node **26.7.0** (`/opt/homebrew/opt/node@26/bin/node`);
`scripts/with-node` is broken (#506). Exit codes read from each run's own
`.exit` file, never through a pipe.

## The question

Another agent measured `check:pet-slide` at roughly 1 red in 5 on "identical
source, no edits between runs", failing with

```
not inside her: Little Mouse was 1 cm inside the child on ridden frame 459
```

and ridden-frame counts swinging 700–767 run to run. Two hypotheses to
separate: (1) the tree measured predates #508, so this is stale; (2) residual
non-determinism #508 did not cover.

## Prior work read before starting (do not redo)

`HANDOFF-pet-slide-496.md` on `origin/fix/pet-slide-496` is thorough and
already eliminated, with evidence: `Math.random` in the harness, the V8 hash
seed, the renderer, the clock inside the check, and `src/core/solveCache.ts`.
It then found and fixed the actual cause (#508).

## Finding 1 — the failure message is seed 346, character-for-character

The quoted failure is not a generic message. #507 records it verbatim as the
signature of **pool seed 346**, and #496's handoff records the identical
string from `--predictable` (which freezes `Math.random` and so freezes the
pool draw). A message naming a specific pet, a specific distance and a
specific frame number is a fingerprint, not a coincidence.

## Finding 2 — #508 is present on current `main`

`src/world/parkSeedPool.ts` on `10fb7c2d` has `inNode()` asking
`process.versions.node`, and `resolveParkSeed()` returning
`CANONICAL_PARK_SEED` before ever reaching `drawFromPool()`.

## Finding 3 — the check itself has no RNG or clock

`scripts/check-pet-slide.mts` (958 lines) contains no `Math.random`, no
`Date.now`, no `performance.now`. Confirms the other agent's own reasoning
that the variance is upstream in park generation.

## Measurement in flight

20 consecutive runs on current `main`, logs in `/tmp/psflake/run-N.log`,
exit codes in `/tmp/psflake/run-N.exit`. Results below when complete.

## Status

Awaiting the 20-run baseline.
