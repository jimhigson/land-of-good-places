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

## It is not confined to the slide — three unrelated systems vary

Diffing two runs' full node lists by subtree (`/tmp/ps496/nodes-{a,c}.txt`,
Node 26.7.0):

| subtree | run a | run c |
|---|---|---|
| `scenery/wooden-walls` | 97 | 65 |
| `scenery/stone-walls` | 41 | 27 |
| `anchor-plots/ginormous-slide-supports` | 9 | 11 |
| `anchor-plots/anchor:dodgems` | 215 | 214 |

Everything else matched. So #496 is filed as a slide-camera flake and it is
**park generation**: walls, the slide's supports and the dodgems all move.

## Eliminated here

- `src/core/solveCache.ts` — localStorage only, and `store()` returns `null`
  under Node, so `cachedSolve` is a straight passthrough in every check.
  Cannot be the cause of any measurement taken on Node.

Already eliminated by the previous agent, not re-derived: `Math.random`,
V8 hash seed (`--hash-seed=1` alone still varies), the renderer, the clock
*inside the check harness* (fixed `dt`, fixed `MAX_FRAMES`).
