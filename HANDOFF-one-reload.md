# Handoff: one reload gets the new build (Safari too)

Branch `fix/one-reload-new-build`, worktree `.claude/worktrees/one-reload`.

## Root cause (measured, not guessed)

- Both engines queue `register()` behind an in-progress install, so
  workbox-window is NOT deaf to an install that began before the page
  registered (my first hypothesis; disproved by `scripts/.exp-timing.mts`,
  never committed).
- The real gap: after a deploy, a reload boots the OLD build fully playable
  while the new precache (89 entries, 8.8 MB raw) downloads. `onNeedRefresh`
  only fires once the download is done, and only adopts on an untouched page.
  A tap during the download (she starts playing) turns it into "ask"; a reload
  during it just shows the old build again. On a phone the download is
  seconds, so that is "refreshed a few times".
- `version-check.ts` does run at boot, but only calls `registration.update()`:
  nothing visible.

## Fix design

- `bootstrap.ts` awaits `readyToBoot` from `setupUpdateGate` (in parallel with
  the park file). Probe `version.txt` (no-store), bounded by
  `ASK_SERVER_WITHIN_MS` (2 s). Different + untouched -> gate "Getting it…"
  now, hold the boot, adopt when `onNeedRefresh` says the worker is waiting,
  bounded by `FETCH_NEW_BUILD_WITHIN_MS` (20 s); else stand down, say so, boot
  the cached build.
- `takeIt` = wait (bounded) for onNeedRefresh, then the existing
  `updateSW(true)`. One path; probe and onNeedRefresh are two triggers.

## Proof

- `check:update-adoption`, 5 phases x {chromium, webkit}. Red on main at
  phase 2 (and phase 4 alone) by outcome too: still on old build, gate asking.
- `UPDATE_ADOPTION_PHASES=2,4` runs a subset (announced on stderr).
