# HANDOFF — wheel-zoom (issue #242)

Branch: `feat/wheel-zoom`. Worktree:
`/Users/jim/dev/landOfGoodPlaces/.claude/worktrees/e-wheel-zoom`.

## Status: implementation + tests done, build/typecheck/procgen green. PR not yet opened.

## What changed

- `src/core/input/PointerControls.ts` — new `onWheelZoom(notches: number)`
  option alongside `onPinch`, a `wheel` listener on the canvas (`{ passive:
  false }`), and `wheelNotches()` which normalises `deltaY`/`deltaMode`
  (pixel/line/page) into a device-independent "notch" count, sign-flipped so
  wheel-up is positive (matches `onPinch`'s "spread fingers = positive").
- `src/Game.ts` — wires `onWheelZoom` to `this.camera.nudgeZoom(notches *
  CAMERA_ZOOM_STEP)`, guarded on `this.cameraOverride` (skip while riding).
  This is the **only** owner of the zoom range/clamp/damping — same as pinch
  and keyboard, all three call `IsoCamera.nudgeZoom`.
- `test/input/wheel-zoom.test.ts` — new. Dispatches real `wheel` `Event`s at a
  fake `EventTarget` canvas (no jsdom in this repo, same pattern as
  `text-entry-guard.test.ts`), asserts `IsoCamera.zoom` actually moves and
  clamps to the literal `CAMERA_ZOOM_MIN`/`CAMERA_ZOOM_MAX` pinch uses.
  **Verified red**: temporarily commented out the `onWheelZoom` call inside
  `onWheel`, reran — 2 of 4 tests failed (the ones asserting real movement),
  confirming the test doesn't just check "listener attached". Restored before
  committing.

## Design decisions worth knowing

- **One notch = one `CAMERA_ZOOM_STEP`.** Chosen to match the `+`/`-`
  keyboard step exactly — same granularity, same feel, discoverable. A
  standard mouse notch (~100px pixel-mode on Chrome/Safari, ~3 lines on
  Firefox/Windows) maps to one notch; ~12 notches sweep the whole
  `CAMERA_ZOOM_MIN`..`CAMERA_ZOOM_MAX` range. Not measured against a huge
  spread of real hardware — **this is the one thing that most wants a human's
  hands on a real trackpad and a real wheel mouse**, see below.
- **`cameraOverride` guard is wheel-only**, not added to `onPinch`. Reasoning
  is in the code comment at the `onWheelZoom` wiring in `Game.ts`: a pinch
  needs a finger actually on the glass, so it essentially can't fire
  mid-ride; a wheel sits under an otherwise-idle mouse hand during a ride, so
  it can. Scope explicitly excludes touching pinch itself.
- **No `event.target` guard needed.** `wheel` is added directly to the
  `<canvas>` element (same as every other `PointerControls` listener), and
  `#game-canvas`/`#ui-root` are DOM siblings (`index.html`), not
  ancestor/descendant — so a wheel event over the shop/Cute-o-dex/character
  creation never reaches this listener at all. Confirmed by reading
  `index.html` and `main.ts`, not just assumed.
- **`WheelEvent.DOM_DELTA_LINE`/`PAGE` are hardcoded as `1`/`2`**, not read
  off the `WheelEvent` global, because this repo's tests run under plain Node
  (no jsdom — see `vitest.config.ts`, no `environment` set) where
  `WheelEvent` doesn't exist as a runtime value, only as a compile-time DOM
  type. Same reasoning `isTextEntryTarget` already documents for duck-typing.

## What still needs a human (or an agent with real browser access)

**I had no working browser automation in this session** — `chrome-devtools`
MCP wasn't present and the `claude-in-chrome` extension isn't connected here
— so the feel of the zoom rate has **not** been checked by hand, only
build/typecheck/tests. Per CLAUDE.md ("if you have not been told you own it,
do not use it: build-verify instead and list in the PR exactly what needs
visual QA"), this is exactly that list:

1. **Zoom direction** on a real wheel and a real trackpad two-finger scroll —
   both regular and macOS "natural" scrolling settings.
2. **Rate/feel** — does one notch feel like the right increment? Does a full
   trackpad swipe traverse a sensible chunk of the range, comparable to a
   phone pinch?
3. **Does not fight rides** — start the Ferris wheel/Rail Race/Sky Cruiser,
   scroll the wheel mid-ride, confirm the camera doesn't jump when the ride
   ends.
4. **Scrolling still works** in the shop, Cute-o-dex and character creation
   while the game canvas sits behind them.

To check: `cd` into this worktree, `npm ci` if not already done, then
`vite --port <your-port> --strictPort` and open in a private window (stale
service workers on reused ports are a known trap — see CLAUDE.md). No deep
link needed; wheel zoom works from the moment the park loads.

## Checks run (all green, exit codes checked directly, not piped)

- `npm run build` — includes `tsc --noEmit`, `typecheck:test`, and the full
  `check:*` procedural-generation/asset suite. Exit 0.
- `npx vitest run` (full suite) — **200 tests passed (10 files)**, read as a
  number off the screen, not the colour.
- `npm run test:procgen` — same 200/200 (this repo's `test:procgen` script is
  a plain `vitest run` over the whole `test/` tree, procgen included; no
  procgen invariant was touched or needed — this feature has nothing to do
  with the generator).

## Scope discipline

Did not touch pinch, panning, or rotation. Did not add a second zoom-range
definition anywhere.
