# HANDOFF: e-no-dev-sw — "service worker should not run on localhost"

Branch `fix/no-service-worker-in-dev`, worktree `.claude/worktrees/e-no-dev-sw`.
My ports: dev **5420**, preview **5421**, headless-Chrome CDP 9333/9334/9335.
All killed at finish. Ports 5408/5409/5410 belong to the Overseer — untouched.

## The headline finding: the code change already landed

The task briefed me that `vite.config.ts` has `devOptions: { enabled: true }`.
**It does not, on `origin/main`.** That reading came from the shared checkout
`/Users/jim/dev/landOfGoodPlaces`, whose local `main` is **206 commits behind
`origin/main`**. `origin/main` already carries **`ca7ad89` "Turn off the
dev-mode service worker by default"** (Jim Higson, 1 Aug 2026):

```ts
devOptions: { enabled: !!process.env.VITE_PWA_DEV, type: 'module' },
```

So brief items 1 (disable), 2 (rewrite comment) and 4 (update CLAUDE.md) were
already substantially done. I did not redo them.

## What I actually did

**Verified both behaviours** (this had not been done), then closed the one real
remaining gap: **neither the config comment nor CLAUDE.md named `npm run
preview` as where the worker is tested.** Both still pointed a reader at
`VITE_PWA_DEV=1 npm run dev`, which by the brief's own correct argument cannot
test the shipped worker — `globPatterns` precaches the *built* output and dev
has none.

## Measurements (clean Chrome profile, same script both sides)

| | `npm run dev` (5420) | `npm run preview` (5421) |
|---|---|---|
| `getRegistrations().length` | **0** | **1** (`http://127.0.0.1:5421/`) |
| `caches.keys()` | `[]` | `workbox-precache-v2-…`, **9 entries** |
| SW lifecycle events for origin | none | new→installing→installed→activating→activated |
| `isSecureContext` | true | true |
| registration-failure console errors | 0 | 0 |

`isSecureContext: true` matters — the dev zero is a real absence, not an
artefact of a context where registration was impossible anyway.

Method: headless Chrome + CDP, throwaway `--user-data-dir`, so no Chrome tab
from the fleet cap was used and the shared profile was untouched. Scripts in
the session scratchpad (`swcheck.mjs`, `probe.mjs`) — throwaway, not committed.

**Also proved with a control**: `/sw.js`, `/dev-sw.js`, `/registerSW.js` and
`/manifest.webmanifest` all return HTTP 200 on the dev server — but so does an
invented path, because Vite SPA-falls-back to `index.html`. All are
`Content-Type: text/html`. On preview, `sw.js` is real `text/javascript`.
Do not read those 200s as evidence of a worker.

## `main.ts`'s unguarded `registerSW(...)` — no guard needed

With `enabled` false the plugin resolves `virtual:pwa-register` to a stub:

```js
function registerSW(_options = {}) { return async (_reloadPage = true) => {}; }
```

It ignores its options entirely, so `onRegisterError` is unreachable **by
construction**, not merely unobserved. Confirmed at runtime:
`window.__triggerUpdateGate` (assigned on the line *after* the `registerSW`
call) is a `function` in dev, so the call returned normally without throwing.
The config stays the single owner; a matching `import.meta.env` check in
`main.ts` would be a second place to keep in sync.

## Checks

- `npm run build` → exit **0**
- `npm run test:procgen` → exit **0**, **141 tests passed, 9 files**, 0 failed,
  0 skipped

## Status

- [x] Verify dev registers no worker — **observed, not inferred**
- [x] Verify preview registers + precaches — observed
- [x] Config comment + CLAUDE.md name `preview` as the truthful test
- [x] build + test:procgen
- [x] Commits `0de0a44`, `e5ace57`
- [ ] PR raised — **do not merge**
