# Handoff — one menu button at the top, and no clock

**Branch:** `hud-menu`, from `origin/main` @ dd68361.
**Status:** done, builds clean, PR raised. Needs visual QA only.

## What changed

- `src/ui/Hud.ts` — the top row becomes `.hud-bar > .hud-menu > (.pill--menu +
  .hud-menu-items)`. The park, purse and backpack pills move into the drawer.
  **`setClock`, `clockPill`, `clockText`, `dayText` and `dayLabel` are
  deleted.**
- `src/ui/CuteODex.ts`, `src/ui/ParkMap.ts` — their pills now mount into
  `.hud-menu-items` rather than `.hud-row` (same `?? container` fallback).
- `src/Game.ts` — the `hud.setClock(...)` call is gone; `formatClock()` moves
  into the debug overlay line so the method stays honest rather than dead.
- `src/style.css` — `.hud-bar`, `.hud-menu`, `.pill--menu`, `.hud-menu-items`;
  `.pill--clock` deleted.
- `src/minigames/overlay.ts` — its HUD-hiding rule now also matches `.hud-bar`
  (or the menu button would stay up during a mini-game) **and** adds
  `visibility: hidden`.
- `whatsnew.json` — entry 13.

## Findings

- **The pointer-events trap.** `#ui-root` is `pointer-events: none` and the
  individual pills opt back in with `pointer-events: auto`. So hiding a
  container with `opacity: 0` + `pointer-events: none` does **not** stop the
  pills inside it taking taps — the descendant's `auto` wins. Both the drawer
  and the mini-game rule therefore use `visibility: hidden`, which really does
  remove an element from hit-testing. The mini-game one was a pre-existing
  latent bug on `main` (invisible backpack/dex/map pills over a mini-game),
  fixed here in passing.
- **The menu owns no game state.** No pause, no input capture, no `uiOpen`.
  That is the strongest form of the `Shopping.syncPaused` lesson: a dropdown
  that pauses nothing cannot leave anything paused. Its one flag reaches the
  DOM in exactly one place, `Hud.applyMenu()`.
- The outside-tap listener that closes the drawer deliberately does **not**
  `stopPropagation` — the tap that puts the menu away is also the tap that
  walks the character.
- The menu button is not blurred on click (it is a toggle, and a keyboard
  player must be able to press it again).
