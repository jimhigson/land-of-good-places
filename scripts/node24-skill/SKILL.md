---
name: node24
description: "Switch this dev container to Node 24 (the version CI uses) to run checks that hang on the default Node 22 — above all `check:park-boot`, whose boot harness deadlocks on Node 22's TypeScript loader. Use when a check or npm script hangs at \"measuring out the park\", when running check:park-boot / the full `npm run build` suite, or whenever you need to reproduce CI's Node locally. Examples: \"run check:park-boot\", \"the park boot check hangs\", \"validate the full build suite\", \"why does generation never finish in the check\"."
---

# Node 24 for this container

## The problem this solves

The cloud dev container comes up on **Node 22** (`/opt/node22`, the default
`node` on PATH). CI, however, pins **Node 24** (`.github/workflows/*.yml`:
`node-version: 24`), and one check genuinely requires it:

**`check:park-boot` hangs forever on Node 22.** Its harness
(`scripts/check-park-boot.mts`) drives `ParkGeneration.advance()` frame by
frame, and `advance()` starts module imports *fire-and-forget* — via
`queueMicrotask(() => import(...)...)`, never awaiting the promise — then the
harness polls with `setImmediate`. On Node 22 + this repo's register-based
TypeScript loader (`--experimental-transform-types` +
`ts-extension-resolver-register.mjs`), a dynamic `import()` whose promise
nobody awaits **never settles** while the event loop is polled that way. So
`importInFlight` never clears, generation sits at "measuring out the park"
with 0 work units, and the check fails with *"the park never finished
generating … the bus would idle at the gate forever."*

It is a **loader/runtime bug, not a bug in the game or the check** — proof:
a bare `await import(...)` settles in ~200 ms on the same box, and the game
runs in a browser where imports always settle. Node 24 settles the
un-awaited ones too, and the check passes. Nodes 20/21 are not an option:
they predate `--experimental-transform-types` and refuse the flag.

Everything *else* (`check:park`, `test:procgen`, `check:solve-cost`, the
unit tests, `tsc`) runs fine on Node 22 — only reach for Node 24 when you
hit the boot check or want to run the whole suite the way CI does.

## How to do it

A helper script wraps any command so it runs under Node 24, installing it
via `nvm` on first use if the container doesn't already have it:

```bash
scripts/with-node24 npm run check:park-boot     # the check that needs it
scripts/with-node24 npm run build               # the whole CI suite
scripts/with-node24 node --version              # sanity: prints v24.x
```

`scripts/with-node24` finds the newest installed `v24.*` under the nvm dirs
(`/root/.nvm/versions/node/v24.*/bin`, `$HOME/.nvm/...`), or runs
`nvm install 24` if none is present, then prepends it to `PATH` and `exec`s
your command. Idempotent and safe to put in front of any `npm`/`node`
invocation.

### Doing it by hand instead

```bash
export NVM_DIR=/root/.nvm; . /opt/nvm/nvm.sh   # nvm is a shell function
nvm install 24                                 # once per fresh container
export PATH="$(ls -d /root/.nvm/versions/node/v24.*/bin | sort -V | tail -1):$PATH"
node --version                                 # v24.x — npm scripts now use it
```

## Notes

- **Per-container.** The container is ephemeral; a fresh session is back on
  Node 22 and needs the install again (the helper does it automatically).
- **It is slow here regardless.** This box measures ~5.4x slower than
  `check:park-boot`'s reference machine, but the check *scales its ceilings*
  by a self-calibrated `slowness` factor, so it still passes — a hang is the
  Node-22 bug, a red *timing* result would be a real regression.
- **Don't "fix" the check to work on Node 22.** The fire-and-forget import +
  poll is how the browser actually loads (module eval happens off `advance()`,
  which is the whole point of the sliced boot). Changing it to satisfy a
  broken local runtime would break the thing the check measures. Use Node 24.
