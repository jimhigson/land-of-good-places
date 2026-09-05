# HANDOFF — #506 / PR #517: which Node the check chain actually runs on

Model: **Claude Opus 5 (1M context)**. Role: Engineer. Branch
`fix/with-node-506`, worktree `.claude/worktrees/with-node-506`.

**Reworked 5 Sept 2026** on Jim's instruction — *"Use fnm to get node version
you need"*. The earlier approach on this branch (a 230-line `scripts/with-node`
that probed Homebrew, fnm, nvm, volta, asdf and mise for the newest Node on the
box) is **deleted**. What follows is the current design; the superseded
account is in this file's git history.

## The hole

The repo declared **neither `.node-version` nor `.nvmrc`**. fnm was installed
(1.39.0), had 26.2.0 and 26.5.0, defaulted to 25.6.1, and Jim's fish already
ran `fnm env --use-on-cd`. So fnm asked the project which Node it wanted and
the project never answered.

Consequence, measured: `pnpm exec node --version` → **v25.6.1**, below the
floor. Every gate line reported as "green on Node 26" from a `pnpm run`
invocation was a claim about a runtime nobody had checked. Direct invocations
through an explicit `node@26` path — the 16-seed sweep, the mutation proofs,
the determinism baselines — genuinely were on 26 and stand.

## The two questions I was told to measure, and the answers

### 1. Does pnpm honour `.node-version`? **No.**

Measured with `.node-version` present and saying `26`, fnm's active Node at
v25.6.1:

```
.node-version says 26; fnm active is v25.6.1
pnpm exec node          -> v25.6.1
pnpm run (real script)  -> v25.6.1
pnpm config get use-node-version -> undefined
```

Control, ruling out "pnpm just always reports the same thing": strip the fnm
multishell from `PATH` so Homebrew's node is first, and pnpm reports
**v26.7.0**. It reports whatever is first on `PATH` and has no opinion about
the file.

**So `.node-version` alone does not fix a `pnpm run` gate line**, and the
ticket does *not* shrink to a one-line file. `check:node` is load-bearing.

### 2. Is CI affected? **No.**

All seven workflows already pinned `node-version: 26`, so CI was always on 26
and this is a **local-developer fix**. The PR description says so and must
keep saying so.

I did still change them — from the literal to
`node-version-file: .node-version` — for a different reason: seven hand-kept
copies of one fact is this repo's most-filed bug, and routing CI through the
file is what makes the file load-bearing rather than decorative. **No change
to which Node CI runs.**

## A third finding, not in the brief

**Nothing switches Node automatically here — and my first reason for that was
wrong.** I originally wrote that `fnm env --use-on-cd` "only helps an
interactive shell". The reviewer measured that false, and the true reason is
better:

```
zsh -c 'eval "$(fnm env --use-on-cd --shell zsh)"; cd <repo>'  ->  Using Node v26.5.0
```

The hook fires fine non-interactively. **It is simply never installed**: fnm is
wired into `config.fish` only, no zsh rc mentions it, `chpwd_functions` is
empty and no fnm function is defined. Same conclusion — the declaration plus a
loud check is the whole mechanism — but someone reasoning from "interactive
only" would draw the wrong inference in a new situation.

## `engine-strict` was tried and rejected on measurement

The review asked me to weigh correcting a comment against adding
`engine-strict=true` to `.npmrc`, on the sound principle that a gate at
*install* time beats a corrected sentence. Measured in a clean-room project
with real resolution, Node 25 against `">=26"`:

| pnpm | plain | `engine-strict=true` |
|---|---|---|
| 11.24.0 | warns `Unsupported engine`, exit 0 | exit 0 |
| **12.1.0** (this repo's pin) | **no warning**, exit 0 | **exit 0** |

`strict-engines` is inert too; in pnpm 12 `engines` survives only as a filter
on which optional dependencies install. **Option B is not available on this
pnpm**, and adding it would have been a setting that looks like a gate and
gates nothing — this ticket's own bug inside its own fix. Comment corrected
instead; `engines.node` stays as declarative metadata, held true solely by
`check:node`'s agreement clause.

Worth knowing if anyone revisits: the version difference is real and is masked
by the `packageManager` pin. A scratch project with no pin runs pnpm 11 and
*does* warn, which is how the original false claim got written.

## What the branch now does

- **`.node-version`** = `26` — the single owner.
- **`scripts/with-node` deleted.** Replaced by `fnm use --install-if-missing`,
  which takes no argument because it reads the declaration. Verified: installs
  if absent, switches, and `pnpm exec node` then reports 26.5.0.
- **`check:node`** stays, first step of `check`. Reads `.node-version` as
  owner, and **fails if `engines.node` disagrees with it** — a mechanism, not
  a comment promising two numbers match.
- **Seven workflows** read `node-version-file: .node-version`.
- **CLAUDE.md and `scripts/node-skill/SKILL.md`** stop naming the deleted
  script; both carry the two measurements above, since neither is guessable.

## Proved red, on this geometry

`check:node`, all three states, exit codes read from the run
(`.node-version` = `26`, `engines.node` = `">=26"`):

| state | exit |
|---|---|
| running Node v25.6.1 | **1** — names `fnm use --install-if-missing` |
| `engines.node` mutated to `">=25"` | **1** — prints both numbers |
| `.node-version` deleted | **1** — cannot pass with nothing to check |
| running Node v26.5.0, both agreeing | **0** |

Exit codes read from unpiped runs. Note `pnpm run check:node | head -3`
reports **134**, not 1 — the pipe masks it, exactly as CLAUDE.md warns.

Chain step **sets** compared by parsing, never grepping: **59 → 60, none
removed, one added** (`pnpm run check:node`); no script *name* removed either.

Workflows verified by **parsing** all seven (ruby YAML), not grepping: each
loads, and every `setup-node` step's `with` is `node-version-file:
.node-version`. No `node-version: 26` literal remains.

## Traps recorded

- **`fnm use` mutates a symlink shared by the whole session.**
  `FNM_MULTISHELL_PATH` is inherited from the Claude Code process, so an
  `fnm use` in one Bash call changes `node` for *every later call in that
  session*. I contaminated one measurement this way and had to redo it with an
  explicit clean `PATH`. Restore with `fnm use default` when measuring.
- **Blanket process matches bite here.** `grep "[w]ith-node"` matches the gate
  shell's own command line, because the worktree is *named* `with-node-506`.
  Kill by PID, or anchor on the binary.
- **`setup-node` accepting a bare major from `node-version-file`** is proved
  by this PR's own CI run: `Resolved .node-version as 26` ->
  `Acquiring 26.8.1`, identical to the literal it replaced.
- **A second person landed on Node 26 by accident.** The reviewer's agent
  shell was on v26.5.0 inherited from an earlier session's `fnm use` rewriting
  the shared multishell symlink — not by any mechanism. The trap above biting
  someone else, and the best argument for the check existing.

## Status

Gates run on **Node v26.5.0** (`fnm use --install-if-missing` in the same
shell). **There are three pre-push gates on `main`, not two** — `check`,
`test:procgen` and `check:coplanar`; the last is easy to miss and is not in
either of the others.

Reviewed 5 Sept: changes requested on two false comments only, both now fixed
and pushed. Invisible to a player → re-approval → QA → merge without Jim.
