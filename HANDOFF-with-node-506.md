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

## The scope grew, and this is why

**`with-node` was a lock on a door that is not in the wall.** Fixing it is
necessary and insufficient: **no script in `package.json` routes through it.**
Every `check:*` step invokes a bare `node`, so the chain runs on whatever is
first on `PATH` — here **v25.6.1**, below the floor, with 26.7.0 installed a
directory away.

Measured, not assumed: `pnpm exec node --version` → `v25.6.1`, and
`node -e "…scripts…"` shows **0 of 60** scripts pin a Node.

So **every local "gates green on Node 26.7.0" report tonight — mine included,
across #512 and #515 — was a claim about a runtime nobody had checked.** The
distinction that survives: direct invocations through the explicit
`/opt/homebrew/opt/node@26/bin/node` path (the 16-seed sweep, the mutation
proofs, the 13-run determinism baseline) genuinely were on 26 and stand; the
`pnpm run` gate lines did not. The damage is to the claim, not the evidence.

### `check:node`, at the head of the chain

`scripts/check-node.mts` states the runtime on every run and **fails below the
floor**, naming the command to type before explaining itself. Verified both
ways: exit **1** on the machine's default v25.6.1, exit **0** under 26.7.0,
and `scripts/with-node pnpm run check:node` green end to end.

**One owner for the floor: `package.json`'s `engines.node`.** This deletes a
duplicate I had myself just written (`MIN_MAJOR=26` in `with-node`) — the
repo's most-filed fault, committed inside the fix for a bug about believing a
stale local copy of the truth. `with-node` parses it with `sed`, never by
running a Node, because it exists for the case where the available Node is
wrong or missing.

Two things checked before shipping it, either of which could have broken the
fleet:

- **pnpm warns but does not fail** on a mismatched `engines` (measured: exit 0,
  `[WARN] Unsupported engine`; no `engine-strict` in `.npmrc`). Declaring it
  cannot break an install — and it buys a free second signal.
- **All seven CI workflows already pin `node-version: 26`**, so the new gate
  cannot redden CI.

Chain step **sets** compared against `origin/main` by parsing (never grepping):
**59 → 60, none removed, one added.**

### This changes the command every agent types

`pnpm run check` now **fails** on this machine unless run as
`scripts/with-node pnpm run check`. That is the intended effect — a silent
wrong runtime becomes a loud one — but it is a workflow change, not just a new
check, and whoever merges should know that.

**Deliberately not done here:** rerouting every script through `with-node`.
That changes how every gate in the project executes and wants its own change
and its own review. Next step, not this PR.

## A red check found on the way, and not reproduced

`pnpm run check` **failed once** on this branch at `check:pet-slide` — step ~44
— dying after its first line with **no verdict, no `FAILED`, no stack**. Run
alone immediately after: exit 0, 675 frames, `deepest inside her 0.00`. A full
re-run of the chain: **exit 0**.

So: **once, not reproduced.** Still a red check by this project's rules. What
was ruled out, so the next person inherits the elimination rather than a clean
slate:

- **Not a crash.** No report in `~/Library/Logs/DiagnosticReports` for `node`,
  where a genuine segfault or abort would leave one. Silent death with no
  output points at an external **SIGKILL** — memory pressure is the obvious
  candidate for step ~44 of a chain that builds a full 3D park per step.
- **Not self-inflicted.** The failed run's log closed at **12:16:51**; every
  `kill` issued in this session ran earlier, during script debugging.
- **Not caused by this branch**, which touches only `scripts/with-node`,
  `SKILL.md`, `check-node.mts` and the manifest — none of which the failing
  step invokes.

### Near-miss worth recording

My kill pattern `grep "[w]ith-node"` **would have matched the gate shell's own
command line** (`cd …/worktrees/with-node-506 && pnpm run check …`), and the
same pattern *did* kill one of my own test commands earlier. That is CLAUDE.md's
blanket-match hazard in a new costume: the worktree *name* made an
innocent-looking pattern dangerous. Match on PID, or anchor the pattern on the
binary rather than on any path.

## Status

Invisible to a player → review → QA → merge without Jim. **Do not merge.**
Gates re-running under a genuinely current Node
(`/tmp/wn-{check,procgen,coplanar,build}3.exit`), which doubles as a third
crash trial. Raise the PR once they are green.
