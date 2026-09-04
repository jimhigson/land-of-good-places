# HANDOFF — #506: `scripts/with-node` silently runs on the wrong Node

Model: **Claude Opus 5 (1M context)**. Role: Engineer. Branch
`fix/with-node-506`, worktree `.claude/worktrees/with-node-506`, based on
`origin/main` `10fb7c2d`.

Measurements on Node **26.7.0**. Exit codes from each run's own file.

## The two faults, and the second was invisible in the issue

1. **It only searched nvm directories.** Reported in #506.
2. **It derived each candidate's version by regex on the directory name**
   (`sed -E 's#.*/node/v([0-9]+)\..*#\1 &#'`). Not in the issue, and it is the
   deeper one: it makes the script depend on a path *layout* rather than on
   the runtime, so every new manager needs new parsing.

## The finding that changed the fix

**Homebrew's v26.7.0 was already on `PATH`** — second, behind an fnm shim at
v25.6.1:

```
/Users/jim/.local/state/fnm_multishells/86942_.../bin/node   v25.6.1
/opt/homebrew/bin/node                                       v26.7.0
```

So this was never a missing install. `which -a node` alone would have found it.
The script never asked the machine anything it could answer.

## What it does now

- **Candidates** from `which -a node`, plus each manager that is *present*,
  asked in its own terms — `brew --prefix <formula>` (so /opt/homebrew and
  /usr/local both work, and keg-only `node@NN` is found), `fnm env --json` for
  `FNM_DIR`, `$NVM_DIR`, volta/asdf/mise.
- **Version by execution.** Every candidate is run and asked `--version`. No
  path parsing anywhere.
- **Fails loudly**: exit 1, listing every Node found, when nothing clears the
  floor and nvm cannot install one. Never falls through.
- **Prints the runtime it chose, every run**, so a transcript records it.

**No hard-coded Homebrew path**, per the brief: a longer list of directories is
the same bug. There is **no OS-level registry of Node installs** — that is
written into the script's header as the reason it is a list of managers at all,
with the mitigation being that each entry is a *query to a tool that is
present* and an unknown manager gets a loud failure naming what was searched.

## A trap worth knowing: fnm multishells

My first version also globbed `~/.local/state/fnm_multishells/*/bin/node`.
That is **12,658 entries against 12 real installs** on this machine — one per
shell session ever opened — and executing each hung the script for minutes. They
are symlinks *into* the real installs, so they add nothing. Dropped, and
candidates are now deduplicated on their **resolved** directory.

Runtime is now **1 second**.

## Proved red

Mutation: `MIN_MAJOR=26` → `99`, so nothing on the machine qualifies.

```
EXIT=1
stdout bytes: 0          <- the command did NOT run: no silent fall-through
with-node: FAILED — no Node >= 99 on this machine.
  Nodes found, none new enough:
    v26.7.0  /opt/homebrew/bin/node
    …14 more, with real versions read from the binaries
```

Restored to 26: exit 0, `with-node: v26.7.0 at /opt/homebrew/bin/node`, 1 s.

## Also fixed: the same bug in the documentation

`scripts/node-skill/SKILL.md` told agents to run **`npm`** in a pnpm repo,
called `build` "the whole CI suite" (it is `vite build` now), and its
"by hand instead" recipe **hard-coded `/root/.nvm`** — the identical
nvm-only assumption that caused #506. A documented recipe that hard-codes a
path is the same defect as a script that does, and it *outlives* the script,
because nobody runs a comment to find out it is wrong.

## Verification

`bash -n` clean. Both invocation forms exercised (with a command, and bare).
Gates in flight: `/tmp/wn-{check,procgen,coplanar,build}.exit`.

## Status

Invisible to a player → review → QA → merge without Jim. **Do not merge.**
Not yet raised as a PR at time of writing; raise once gates are green.
