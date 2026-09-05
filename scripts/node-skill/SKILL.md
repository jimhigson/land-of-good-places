---
name: node
description: "Run this repo's checks on the Node it declares in `.node-version` (26+), which it requires because its scripts run TypeScript natively (no bundler/transpile). A shell that has not switched — any shell without fnm's cd hook installed, and the cloud dev container's older default — fails or hangs until you run `fnm use --install-if-missing`. Use when a check errors with 'bad option', ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX, or hangs at \"measuring out the park\"; when `check:node` fails; or to reproduce CI locally. Examples: \"run check:park-boot\", \"the build says bad option\", \"validate the full suite\", \"reproduce CI\"."
---

# Current Node for this repo

## The one command

```bash
fnm use --install-if-missing
```

No argument: it reads **`.node-version`** at the repo root, installs that Node
if the machine has not got it, and switches the current shell to it. Then run
your command in that same shell.

If fnm is missing: `brew install fnm`, or
`curl -fsSL https://fnm.vercel.app/install | bash`.

## Why it is needed even when the machine has Node 26

The checks and `scripts/*.mts` run **straight on Node** — no bundler, no
transpile step — and Node runs TypeScript by **stripping types** natively.
That needs a **current Node**, which `.node-version` declares and which the
CI workflows read from that same file (`node-version-file`).

Two things do **not** happen by themselves, both measured on this project:

- **pnpm ignores `.node-version`.** With the file saying 26 and the shell's
  Node at v25.6.1, `pnpm exec node --version` returned **v25.6.1**. pnpm
  spawns scripts with whatever `node` is first on `PATH`; it has no opinion
  about the file. So `pnpm run check` does not fix its own runtime.
- **Nothing switches Node for you.** `fnm env --use-on-cd` installs a `cd`
  hook, and that hook works fine in a non-interactive shell — measured:
  `zsh -c 'eval "$(fnm env --use-on-cd --shell zsh)"; cd <repo>'` prints
  `Using Node v26.5.0`. The reason you do not get it is that **it is never
  installed in your shell**: fnm is wired into `config.fish` only, no zsh rc
  mentions it, `chpwd_functions` is empty. Not "the hook cannot fire here" —
  there is no hook.

Together those are issue #506: for months the gate chain ran on whatever Node
was first on PATH, and every local "green on Node 26" from a `pnpm run` line
was a claim about a runtime nobody had checked.

`pnpm run check`'s **first step is `check:node`**, which is what makes that
loud now. It prints the runtime on every run, pass or fail, so a transcript
records which Node a measurement was taken on.

## Symptoms of the wrong Node

None of these is a real bug in the code:

- **`node: bad option: --experimental-transform-types`** — an old flag
  lingering in a script. Modern Node removed it; the fix is to remove the
  flag, never to install an old Node (see CLAUDE.md, "Use current runtimes").
- **`ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`** — non-erasable syntax (a parameter
  property, an enum, a namespace). `erasableSyntaxOnly` in `tsconfig.json`
  forbids these so it cannot happen; if you hit it, `tsc` points at the exact
  line to rewrite.
- **`check:park-boot` hangs at "measuring out the park"** — on some older
  Node + this repo's register-based TS loader, the boot harness's
  fire-and-forget dynamic imports never settle. A current Node settles them
  and the check passes.

## Notes

- **One owner.** `.node-version` is it. `package.json`'s `engines.node`
  restates it so pnpm can warn on install, and `check:node` **fails if the
  two disagree** — they are not kept in step by a comment.
- **Per-container.** A cloud container is ephemeral; a fresh session needs
  `fnm use --install-if-missing` again. It is one command, and it installs.
- **Never write to the old runtime.** If a new Node rejects the input, fix the
  input — that is the whole point of `erasableSyntaxOnly` and of removing
  transpile flags. Reaching for an old Node or an old-only flag is the
  anachronism the CLAUDE.md rule forbids.
- **It is slow in a container regardless.** Those boxes measure several times
  slower than `check:park-boot`'s reference machine, but the check scales its
  ceilings by a self-calibrated `slowness` factor, so it still passes — a hang
  or a `bad option` is an environment/anachronism problem, whereas a red
  *timing* result would be a real regression.
