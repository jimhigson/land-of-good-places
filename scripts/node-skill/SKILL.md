---
name: node
description: "Run this repo's checks on a current Node (26+), which it requires because its scripts run TypeScript natively (no bundler/transpile). The cloud dev container ships an older default Node, so checks fail or hang until you switch. Use when a check errors with 'bad option', ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX, or hangs at \"measuring out the park\"; when running check:park-boot or the full `pnpm run check`; or to reproduce CI locally. Examples: \"run check:park-boot\", \"the build says bad option\", \"validate the full suite\", \"reproduce CI\"."
---

# Current Node for this repo

## Why it matters

The checks and `scripts/*.mts` run **straight on Node** — no bundler, no
transpile step — and Node runs TypeScript by **stripping types** natively.
That needs a **current Node (26+)**, which CI pins
(`.github/workflows/*.yml`: `node-version: 26`). The cloud dev container,
however, comes up on an **older default `node`** on PATH. On the old one you
get one of these, none of which is a real bug in the code:

- **`node: bad option: --experimental-transform-types`** — if any old flag
  lingers in a script. Modern Node stripped that flag out; the fix is to
  remove the flag, never to install an old Node (see CLAUDE.md, "Use current
  runtimes").
- **`ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`** — non-erasable syntax (a parameter
  property, an enum, a namespace). `erasableSyntaxOnly` in `tsconfig.json`
  forbids these so it cannot happen; if you hit it, `tsc` will point at the
  exact line to rewrite.
- **`check:park-boot` hangs at "measuring out the park"** — on some older
  Node + this repo's register-based TS loader, the boot harness's
  fire-and-forget dynamic imports never settle. A current Node settles them
  and the check passes.

## How to do it

`scripts/with-node` puts a current Node (26+) in front of any command. It finds
the newest one installed — asking PATH and every version manager present
(Homebrew, fnm, nvm, volta, asdf, mise) in that manager's own terms — and
installs the latest via `nvm` if there is none and nvm is available:

```bash
scripts/with-node pnpm run check:park-boot    # needs a current Node
scripts/with-node pnpm run check              # the 47-step gate
scripts/with-node node --version              # sanity: v26.x
```

**It prints the runtime it chose on every run**, so a transcript records which
Node a measurement was taken on:

```
with-node: v26.7.0 at /opt/homebrew/bin/node
```

**And it never hands you an older Node.** If it cannot find or install one that
clears the floor it exits **non-zero**, listing every Node it did find. That is
issue #506: the version before this one searched nvm's directories only, missed
a Homebrew Node 26 that was installed the whole time, and silently left callers
on v25.6.1 — which is why the #496 determinism hunt spent days measuring on a
runtime where the bug it was chasing cannot occur.

### By hand instead

Rarely needed, and prefer the script — a hand-written path is how #506 happened.
Ask whichever manager you use where its Nodes are, rather than assuming a
layout:

```bash
brew --prefix node                             # Homebrew, either prefix
fnm env --json                                 # FNM_DIR, then node-versions/*
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"; . "$NVM_DIR/nvm.sh"
```

Then put that install's `bin` first on `PATH` and **check what you got**
(`node --version`) rather than trusting the directory's name.

## Notes

- **Per-container.** The container is ephemeral; a fresh session is back on
  the old default and needs the install again (the helper does it for you).
- **Never write to the old runtime.** If a new Node rejects the input, fix
  the input — that is the whole point of `erasableSyntaxOnly` and of removing
  transpile flags. Reaching for an old Node or an old-only flag is the
  anachronism the CLAUDE.md rule forbids.
- **It is slow here regardless.** This box measures several times slower than
  `check:park-boot`'s reference machine, but the check scales its ceilings by
  a self-calibrated `slowness` factor, so it still passes — a hang or a
  `bad option` is an environment/anachronism problem, a red *timing* result
  would be a real regression.
