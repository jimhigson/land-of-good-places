---
name: node
description: "Run this repo's checks on a current Node (26+), which it requires because its scripts run TypeScript natively (no bundler/transpile). The cloud dev container ships an older default Node, so checks fail or hang until you switch. Use when a check errors with 'bad option', ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX, or hangs at \"measuring out the park\"; when running check:park-boot or the full `npm run build`; or to reproduce CI locally. Examples: \"run check:park-boot\", \"the build says bad option\", \"validate the full suite\", \"reproduce CI\"."
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

`scripts/with-node` puts a current Node (26+) in front of any command,
installing the latest via `nvm` on first use if the container lacks one:

```bash
scripts/with-node npm run check:park-boot     # needs a current Node
scripts/with-node npm run build               # the whole CI suite
scripts/with-node node --version              # sanity: v26.x
```

### By hand instead

```bash
export NVM_DIR=/root/.nvm; . /opt/nvm/nvm.sh   # nvm is a shell function
nvm install node                               # 'node' = the latest release
export PATH="$(ls -d /root/.nvm/versions/node/v*/bin | sort -V | tail -1):$PATH"
node --version                                 # npm scripts now use it
```

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
