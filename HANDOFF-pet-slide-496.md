# HANDOFF — #496 pet-slide flake / park non-determinism

Model: **Claude Opus 5 (1M context)**. Branch `fix/pet-slide-496`,
worktree `.claude/worktrees/pet-slide-496`, based on `origin/main` `488605cd`.

## Reproduction (all numbers on Node **26.7.0**, `/opt/homebrew/opt/node@26/bin/node`)

`check:pet-slide`, 6 runs: all exit 0, but **5 distinct outputs**; the
"never closer to her own body than" number was 0.17 / 0.11 / 0.11 / 0.20 /
0.09 / 0.14 m. Logs `/tmp/ps496/n26-*.log`.

## The finding that moves this on

**The non-determinism is in park *generation*, not in the simulation.**
A throwaway probe (not committed — it built `new World(...)` and hashed the
whole scene graph: traversal order + world positions at 17 sig figs) run 6
times on Node 26.7.0:

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

## ROOT CAUSE — every Node-26 check has been measuring a randomly drawn park

Traced by instrumenting `createRandom` to print each RNG's seed and call site.
**The very first RNG of the park already differs**: `seed=267` in one run,
`seed=115` in the next, at `src/world/boundary.ts:526` (`solveBoundaryRadii`).
Both numbers are members of `PARK_SEED_POOL`. So `PARK_SEED` itself is
different every run.

Measured directly (a throwaway probe printing `PARK_SEED`; the committed
equivalent is now `scripts/seed-report.mts`):

| Node | run 1 | 2 | 3 | 4 | 5 | `parkSeedSource()` |
|---|---|---|---|---|---|---|
| **26.7.0** | 326 | 326 | 20260728 | 274 | 5 | `drawn` |
| **25.6.1** | 20260728 | 20260728 | 20260728 | — | — | `remembered` |

### The mechanism, in three lines that are each individually reasonable

1. `scripts/headless-dom.mjs:227` — `globalThis.localStorage ??= { getItem: () => null, setItem() {}, removeItem() {} }`.
2. `src/world/parkSeedPool.ts` — `storage()` returns any `localStorage` whose
   `getItem` does not throw; `resolveParkSeed()` then reaches
   `drawFromPool()`, which is `Math.floor(Math.random() * PARK_SEED_POOL.length)`.
3. `parkSeedPool.ts`'s own doc comment: *"In Node, with nothing pinned, this
   is still `CANONICAL_PARK_SEED`, **because there is no localStorage**"* —
   an accident of the runtime relied on as a mechanism.

**The Node version flips which way it falls, and that is the whole "it is
Node 26" story:**

- **Node 25.6.1** ships its own `globalThis.localStorage`, so `??=` does
  **not** install the shim. Node's own `localStorage` *throws* on `getItem`
  (`--localstorage-file was not provided`), `storage()` catches it and returns
  `null`, and `resolveParkSeed()` takes the `store === null` branch →
  `CANONICAL_PARK_SEED`. Deterministic, by luck.
- **Node 26.7.0** has `globalThis.localStorage === undefined` (Web Storage is
  still behind `--localstorage-file`), so the shim **is** installed. Its
  `getItem` returns `null` without throwing, so `storage()` hands it back →
  nothing remembered, no save → **`drawFromPool()` → `Math.random()`**. And
  the shim's `setItem` is a no-op, so nothing is ever remembered and every
  single run draws afresh.

This explains every observation on the issue, including the two the previous
agent could not reconcile:

- **why `--hash-seed=1` alone still varied** — the hash seed does not touch
  `Math.random`;
- **why `--predictable` is byte-identical** — it makes V8's `Math.random`
  deterministic, so the same pool seed is drawn every time. It did not fix
  the park; it froze the coin.
- **why `Math.random` looked eliminated** — it was, on Node 25, because that
  code path is never reached there.

### Scope: much wider than #496

On the runtime this repo requires and CI pins, **every check script that
imports `headless-dom.mjs` has been building a random park from the pool
rather than the canonical seed.** `check:pet-slide` is simply the one with
thresholds tight enough to notice.

The deployed game is unaffected: a real browser has a real `localStorage`,
the draw is the intended per-child park, and it is remembered.

## The fix (pushed)

`src/world/parkSeedPool.ts` — `resolveParkSeed()` now asks the **runtime**
whether it is Node (`process.versions.node`, which no harness fakes and which
the browser bundle does not have) instead of inferring it from the absence of
a `localStorage`. In Node it returns `CANONICAL_PARK_SEED` and never draws.

The browser's own half is split into an exported `parkSeedFor(store)`, so
`check:seed-pool` can still exercise the draw/remember/forget path from Node
without being able to lie about which runtime it is on.

**Node 26.7.0, six runs after: `PARK_SEED=20260728` every time. `LGP_SEED=115`
still pins. The whole park is byte-identical, 4/4** (scene hash `2671dac3…`,
7030 nodes, over the scene-graph probe described above).

## `check:seed-pool` was green through all of this, and why

It had the right-sounding clause —

```
delete (globalThis as { localStorage?: Storage }).localStorage;
check('Node, with no storage and nothing pinned, gets the canonical seed', …)
```

— which **deletes the storage first**, so it asked about a hypothetical Node
rather than the one every check script runs in. It constructed the absence of
the very condition that caused the bug. Replaced with clauses that ask with a
storage present, plus an end-to-end clause that boots six real harnesses
(`scripts/seed-report.mts`, which imports `headless-dom.mjs` exactly as every
check does) and compares the park each built.

**Control**, always run: `scripts/seed-report-control.mts` deliberately draws
at random, and the check **fails if the control does not disagree with
itself** — a repetition test that cannot see a difference would pass for ever.

### Proved red (mutation, so it can be re-armed)

Mutation: delete this block from `resolveParkSeed()` in `parkSeedPool.ts`,
leaving `return parkSeedFor(storage());` in its place —

```ts
  if (inNode()) {
    source = 'remembered';
    return CANONICAL_PARK_SEED;
  }
```

Result on Node 26.7.0, **exit 1, 4 failures**, the end-to-end clause reading
`got 5, 346, 11, 131, 225, 128` from six harnesses. Restored: exit 0, control
at 4–5 distinct in 6 either way.

## `--predictable` drew seed 115, not the canonical park

Measured on the pre-fix code: `--predictable` resolves `PARK_SEED=115`, three
for three. So the deterministic red the previous agent handed over —
`Little Mouse was 1 cm inside the child on ridden frame 459` — is a finding
about **pool seed 115**, not about the canonical park. `--predictable` did not
make the park deterministic; it froze `Math.random` and so froze the draw.

On the **canonical** park, `check:pet-slide` passes: 5 clean runs, all exit 0
and byte-identical, `never closer to her own body than 0.12 m`. (A 6th run in
that batch died on `ERR_INVALID_TYPESCRIPT_SYNTAX` — my own interference, see
the git-stash note below — not a result.)

Seed 115 is a park a child can actually draw, so a 1 cm clip there is a real
visible defect. Sweeping all 16 pool seeds now to size it.

## Hazard for the fleet: **`git stash` is shared across worktrees**

`git stash -u` in a clean worktree saves nothing, and the following
`git stash pop` popped **another agent's** WIP (`chore/preview-incognito-advice`)
into this worktree — conflict markers in `Building.ts` and four other files.
It conflicted, so the entry was **kept**, and `git stash list` still shows both
entries untouched; `git reset --hard HEAD` restored this worktree. No work was
lost, but the stash stack is one shared stack for every worktree in this repo.
**Do not use `git stash` here.** Copy the file aside instead.

## Verification status

- `tsc --noEmit` — **exit 0**. `tsc --noEmit -p tsconfig.test.json` — **exit 0**.
  Both on Node 26.7.0.
- `check` chain step **sets** compared against `origin/main` by parsing
  `package.json`: 58 steps both sides, **none removed, none added**;
  `check:seed-pool` and `check:pet-slide` both present. The chain is untouched
  by this branch.
- `check:seed-pool` — exit 0 green, exit 1 with 4 failures under the mutation
  above.
- Sweep of `check:pet-slide` across all 16 pool seeds in flight; then the full
  `pnpm run check`, `test:procgen`, `build`.
