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

**`fnm env --use-on-cd` only ever helps an interactive shell.** It installs a
`cd` hook in Jim's *fish* rc. An agent's Bash tool shell is **zsh** — proved
by `functions -q` erroring with `(eval):functions:1: bad option: -q` — so the
hook does not exist there and `cd`-ing into the repo switches nothing.

That is why the fix cannot be "declare the file and let the hook do it": for
every agent on this project, nothing switches automatically at all. The
declaration plus a loud check is the whole mechanism.

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
| running Node v26.5.0, both agreeing | **0** |

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
  by this PR's own CI run, not locally — that is the honest verification and
  it is loud if wrong.

## Status

Gates run on **Node v26.5.0** (`fnm use --install-if-missing` in the same
shell). Invisible to a player → review → QA → merge without Jim.
