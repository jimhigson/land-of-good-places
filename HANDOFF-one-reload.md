# Handoff: one reload gets the new build (Safari too)

Branch `fix/one-reload-new-build`, worktree `.claude/worktrees/one-reload`,
**PR #788** (open, not to be merged by me). Code done; waiting on CI.

## Root cause (measured, not guessed)

- Both engines queue `register()` behind an in-progress install, so
  workbox-window is NOT deaf to an install that began before the page
  registered (first hypothesis; disproved by a scratch timing experiment).
- The real gap: after a deploy, a reload boots the OLD build fully playable
  while the new precache (89 entries, 8.8 MB raw) downloads. `onNeedRefresh`
  only fires once the download is done, and only adopts on an untouched page.
  A tap during the download turns it into "ask"; a reload during it just shows
  the old build again. On a phone the download is seconds: "refreshed a few
  times".

## Fix (as shipped in #788)

- `bootstrap.ts` awaits `readyToBoot` (parallel with the park file).
- `updateGateSetup.ts`: `decide()` (two triggers: version.txt answer,
  `onNeedRefresh`) and `takeIt()` (wait <= FETCH_NEW_BUILD_WITHIN_MS for the
  download, then `updateSW(true)`); give-up stands the gate down and boots.
- `update-adoption.ts` owns the bounds (2 s, 20 s); the touch watch starts
  when the park starts to load.
- `version-check.ts` also checks on return to the front.
- CI: `update-adoption.yml` gains a macOS WebKit job.

## Proof

- `check:update-adoption`, 5 phases x {chromium, webkit}, green on head.
- Red on main (worktree at 6cfaf291 + final check + the 2 constants):
  phases 2, 4, 5 red both engines; phase 3 green (control). Outcome-only
  variant also red: still on old build 25 s after the download, gate asking.
- Mutations red: skipWaiting true (3), no boot hold (2, 4), ignore touch (3),
  unbounded ask (1), no probe trigger (2), unbounded fetch (5).
- `UPDATE_ADOPTION_PHASES=2,4` runs a subset (announced on stderr).
- Screenshots: `qa-screenshots` branch, `one-reload-new-build/`.

## If resuming

Watch #788's CI, especially the new WebKit job on `macos-latest` (first run
of WebKit in CI; if Playwright's WebKit will not launch there, that is the
thing to fix). Nothing else outstanding.
