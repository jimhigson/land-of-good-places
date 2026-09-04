# HANDOFF — #496 pet-slide flake / park non-determinism

Model: **Claude Opus 5 (1M context)**. Branch `fix/pet-slide-496`,
worktree `.claude/worktrees/pet-slide-496`, based on `origin/main` `488605cd`.

## Reproduction (all numbers on Node **26.7.0**, `/opt/homebrew/opt/node@26/bin/node`)

`check:pet-slide`, 6 runs: all exit 0, but **5 distinct outputs**; the
"never closer to her own body than" number was 0.17 / 0.11 / 0.11 / 0.20 /
0.09 / 0.14 m. Logs `/tmp/ps496/n26-*.log`.

## The finding that moves this on

**The non-determinism is in park *generation*, not in the simulation.**
`scripts/probe-world.mts` builds `new World(...)` and hashes the whole scene
graph (traversal order + world positions, 17 sig figs). 6 runs, Node 26.7.0:

| run | nodes | sceneHash |
|---|---|---|
| 1 | 7037 | 8dc10234 |
| 2 | 7056 | 8c741b68 |
| 3 | 7028 | 8ba8eec5 |
| 4 | 7027 | 8b02afee |
| 5 | 7028 | 8ba8eec5 |
| 6 | 7047 | 908d1bef |

**The object counts differ.** That rules out floating-point drift: the
generator is taking different *decisions*, not producing slightly different
numbers. The slide's own chute geometry differs too (`chuteHash`).

So `check:pet-slide` is not a flaky check. It is the check whose thresholds
are tight enough to notice that **the same seed does not build the same park
on Node 26**.

## Status

Isolating which generator decision varies. Do not widen thresholds; do not
add `--predictable` to the test command.
