# Handoff: keychain rack — walk-up-and-enter, camera zoom, tap to pick

Branch `shop-zoom-select`, off `origin/keychain-size-physics` (tip
`def3a42`, the "keychain zones invisible to parkFacts" fix).

## What Jim asked for

Having tried the six-separate-walk-up-zones cut live: *"Interesting take.
You should still be able to 'enter' the shop, but the menu is the camera
zooming in on the wares and select by clicking or tapping the one you
want."*

## What changed

- **One `InteractZone`, `stall:keychain`** (`KeychainShop.shopEntryZone`) —
  the whole cart, walk-up-and-press-E/tap-it, same convention every other
  garden stall uses. Pressing it (`beginView`) opens the zoomed picker.
- **`Game.tick`** drives the real park camera (`IsoCamera`) onto the rack's
  own centre at the game's own zoom ceiling (`CAMERA_ZOOM_MAX`) while
  `KeychainShop.viewOpen`, via two new `IsoCamera` methods —
  `setFocusOverride`/`clearFocusOverride` — that override the ordinary
  player-follow target with a fixed world point, damped exactly like the
  existing follow. Saves/restores whatever zoom she had before opening.
- **Once open, the six charms become their own `InteractZone`s again** —
  the *exact* zones/actions the immediately-prior commit built
  (`charmZone`/`charmActions`, unchanged) — reached through the ordinary
  SELECTION RULE (`Selection.ts`): hover/tap picks one, the rainbow outline
  and chip appear over it, pressing the chip (or E, since she's within
  reach of all six from one stand point) equips it. **Deliberately did not
  invent new click-handling** — the existing Selection/Highlights/
  ActionChips machinery is reused wholesale, which is why the game is
  **not paused** while the view is open (pausing would have blocked
  `Selection` itself, per `selectionBlocked()`).
- **Three ways to leave**: the on-screen ✕ (`.keychain-view-close`, reusing
  `.shop-close` — the same class `Shopping`/`ParkMap` already use), Esc/
  cancel, or simply walking far enough from the stand point
  (`KeychainShop.update`, `VIEW_EXIT_REACH`) — this last one only works
  because the view doesn't pause the park.
- **`interactZones()` returns either the one entry zone or the six charms,
  never both** — they sit on the same small cart, and a snapshot holding
  both would fail `check:tap-spacing`'s spacing rule outright. Both real
  states are now checked explicitly rather than only whichever is default:
  `scripts/check-tap-spacing.mts` opens the view for one extra "space" (the
  same way it moves its probe player between hotel rooms);
  `test/procgen/parkFacts.ts` gained a `keychainCharmEntrances` field, built
  by opening the view for one extra read, which
  `keychainStallStandIsUsable` (`test/procgen/invariants.ts`) now reads
  instead of `facts.entrances`.
- `requestOpen()` (the `/keychain-stall` deep link's entry point) now
  teleports **and** opens the view in one motion, so the deep link lands on
  the actual feature rather than one press short of it.
- `scripts/check-deep-links.mts`'s keychain assertion was checking
  `keychainShop.uiOpen`/`.keychain-panel` — both deleted by the
  immediately-prior "rack IS the picker" commit, so this check has read as
  a hard `false` since then (not gated in CI, so nobody saw it go red).
  Fixed to check `viewOpen`/`.keychain-view-close` instead, while I was
  already in this exact code.

## Verification

- `npx tsc --noEmit`: clean.
- `npm run test:procgen`: 383/383 passed (14 files) — the reachability
  invariant now reads `keychainCharmEntrances`.
- `npm run check:tap-spacing`: **OK** — 8 spaces (one more than before: "the
  keychain rack, opened"), 113 zones, 0 real failures; the six-charm
  same-verb overlaps report as harmless warnings exactly as the
  immediately-prior commit's did.
- Real-browser QA (Playwright/Chromium, headless, against `/keychain-stall`
  on a dedicated dev server, port 5943): confirmed `viewOpen` flips true and
  the close button shows on the deep link; confirmed `IsoCamera.zoom` climbs
  toward `CAMERA_ZOOM_MAX` and `focusPoint` converges toward the rack's own
  centre over real ticks (both trending correctly — see below re: sandbox
  load); screenshots in this session's scratchpad.

## `npm run build`'s `check:park-boot` failure — pre-existing, environmental, not this diff

Full `npm run build` failed at `check:park-boot` (a Sky Cruiser/Ginormous
Slide generation-timing budget check), twice in a row, with a **different**
named culprit each time (`cruiserSearch` once, an overrun-budget slice the
next) — the signature of scheduling noise on a contended box, not a
deterministic defect. `ps`/`uptime` during this session showed load average
~4 on a 4-core box with several other agents' worktrees, dev servers and
`npm run build`s running concurrently. This diff touches none of
`boot/parkGeneration.ts`, `world/coaster/*` or `world/slide/*`.

This is not new: `HANDOFF-rack-picker.md` (the immediately-prior branch)
documents the identical failure reproducing on the **unmodified base
branch**, 1/2 runs, under the same conditions, and traces it back further
still to `HANDOFF-keychain-size-physics.md`. Root-caused, not re-litigated
here — see that handoff for the fuller investigation. Deferring to real
GitHub Actions CI (dedicated runners) as the authoritative signal, per this
task's own instructions.

The same contention made headless-Chromium QA in this sandbox run at
roughly 0.5 real frames per second at times (`frameContext.frame` advancing
1 per ~2s of wall clock) — patient long waits were needed to see the
camera's damped move actually converge; a short wait alone looks like the
feature is broken when it is really just starved of real ticks.

## If picking this up

- Feature is code-complete and locally verified except the environmental
  `check:park-boot` flake above.
- `/keychain-stall` is the QA entry point — teleports and opens the zoomed
  view in one motion now.
- Dev server for QA: my own, port 5943 (`vite --port 5943 --strictPort`) —
  kill only that PID, not any other agent's.
- Next: push, open the PR, confirm real GitHub Actions CI is green (not
  just this sandbox), post screenshots + findings as a PR comment per
  CLAUDE.md's screenshot rule.
