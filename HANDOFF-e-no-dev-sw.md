# HANDOFF: e-no-dev-sw — "service worker should not run on localhost"

Branch `fix/no-service-worker-in-dev`, worktree `.claude/worktrees/e-no-dev-sw`.
My dev server port: **5420** (`vite --port 5420 --strictPort`). Kill by PID only.

## The headline finding: the code change already landed

The task briefed me that `vite.config.ts` has `devOptions: { enabled: true,
type: 'module' }`. **It does not, on `origin/main`.** That reading came from the
shared checkout `/Users/jim/dev/landOfGoodPlaces`, whose local `main` is
**206 commits behind `origin/main`**.

`origin/main` already carries commit **`ca7ad89` "Turn off the dev-mode service
worker by default"** (Jim Higson, Sat 1 Aug 2026), which sets:

```ts
devOptions: {
  enabled: !!process.env.VITE_PWA_DEV,
  type: 'module',
},
```

CLAUDE.md's "A stale service worker will waste your hour" section was rewritten
in the same period and already says the dev server no longer registers one.

So task items 1 (disable), 2 (rewrite comment) and 4 (update CLAUDE.md) are
substantially **already done**. Do not redo them.

## What genuinely remains

- **Verification.** Nothing in the tree shows anyone confirmed the two
  behaviours empirically. Item 1 (no worker on plain `npm run dev`) and item 3
  (`npm run preview` still registers + precaches) are the real work.
- **A documentation gap that matches the task's reasoning.** Both the
  `vite.config.ts` comment and CLAUDE.md point a reader who wants to test the
  worker at `VITE_PWA_DEV=1 npm run dev`. By the task's own argument that is
  the *untruthful* test: `workbox.globPatterns` precaches the **built** output,
  and in dev there is no built output. `npm run preview` serves the real build
  with the real precache manifest and the real `clientsClaim:false` /
  `skipWaiting:false` waiting-worker behaviour. Neither file names it.

## Status

- [x] Worktree + `npm ci` (exit 0)
- [ ] Verify dev registers no worker
- [ ] Verify preview registers + precaches
- [ ] Doc change (if verification supports it)
- [ ] build + test:procgen
- [ ] PR
