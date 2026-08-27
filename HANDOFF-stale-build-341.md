# HANDOFF — issue #341, a returning player never gets a new deploy

Branch `fix-stale-build-341`, based on `origin/main` (`797b247`).

## Root cause (measured, not inferred)

`vite.config.ts` runs the worker in `registerType: 'prompt'` with
`skipWaiting: false` / `clientsClaim: false`. A new build therefore installs and
parks itself in the browser's **`waiting`** state, and the only thing that can
promote it is a `SKIP_WAITING` message (`updateSW(true)` → workbox's
`messageSkipWaiting`) or every client on the origin going away.

**A reload is not that.** The tab being reloaded remains a client of the old
worker for the whole navigation, so the old worker is never the last client to
leave. Reload, hard-reload, wait, reload again: same bundle. Detection was never
broken — `UpdateGate` re-offered on every visit (`gate=true waiting=true`) —
only adoption was.

Reproduced on the pre-fix build, real hashes off the screen:

```
visit 1 (old build, SW installs)  : index-cAnvqz7M.js  sw=none   waiting=false gate=false
visit 2 (old build, SW controls)  : index-cAnvqz7M.js  sw=sw.js  waiting=false gate=false
>>> deploy: index-cAnvqz7M.js -> index-Bd2fwgK2.js
visit 3 (one reload after deploy) : index-cAnvqz7M.js  sw=sw.js  waiting=true  gate=true   <-- stuck
```

## The fix

`src/update-adoption.ts` owns one question: **has anyone touched this page since
it loaded?** On a page nobody has (a returning player who has just reloaded),
`main.ts` calls `gate.showAndGo(...)` — the gate presses its own button, same
code path a finger takes. Once she is playing, it is `gate.show(...)` exactly as
before, because a swap means a reload and a reload mid-ride loses the ride.

`registerSW({ immediate: true })` so the answer arrives before the window `load`
event rather than after it.

A `sessionStorage` note (`lgp.updateAdoptedFrom`) records the version we swapped
away from, so a swap that does not take degrades to the button instead of an
infinite reload loop.

### Why it is safe mid-session

Every dynamic `import()` in `src/` is a boot-time one: `main.ts:500`'s `./Game`
chunk and `boot/parkGeneration.ts`'s generation slices. A tab that has finished
booting holds all of its code already, so sweeping the old precache cannot break
it. The exposure is a tab still booting, which is exactly the tab that is about
to reload anyway — and the gate (`z-index: 200`) covers the boot splash
(`z-index: 10`), so even a chunk failure in that window is behind the card.

This is why `skipWaiting: true` in the worker is *not* the fix: it swaps with no
reload behind it, on a page that may be mid-boot, with nothing on screen to
explain it.

## The check

`npm run check:update-adoption` (`scripts/check-update-adoption.mts`), plus
`.github/workflows/update-adoption.yml` which installs Chromium for it. Two real
builds from one tree (`APP_VERSION` override, added to `vite.config.ts`), one
flippable static server, one persistent Chromium profile. Both directions:

- one ordinary reload after a deploy must land on the new bundle, nobody
  pressing anything;
- a deploy landing **while somebody is playing** must *not* swap the page, must
  raise the gate, and the button must still work.

Deliberate breaks, both seen red with real hashes:

- pre-fix source → `a returning player is STILL executing index-cAnvqz7M.js 25s
  after an ordinary reload`.
- `canAdoptWithoutAsking()` forced to `true` → `the page swapped itself to
  index-CiPGhh4_.js while someone was playing, without being asked`.

## Sandbox limits hit (report, do not route around)

- `*.workers.dev` is 403 by egress policy here, so the PR preview cannot be
  opened or verified from this box.
- Headless Chromium cannot complete TLS to `landofgoodplaces.blockstack.ing`
  through the proxy (`ERR_CONNECTION_RESET`); `curl` can.
