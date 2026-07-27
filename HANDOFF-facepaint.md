# HANDOFF — fix/face-paint-crash (P0)

## Status
ROOT CAUSE (the one line worth keeping): the face-paint panel is appended to
`#ui-root` by `World`'s constructor, and `new Hud(uiRoot)` — built ~80 lines
later in `Game` — starts with `uiRoot.innerHTML = ''` and deletes it; and the
painting cutscene advances on `frameContext.dt`, which the stall's own
`syncPaused()` has just forced to zero, so it never ends and the park stays
paused forever.

Fix written, `npm run build` green (exit 0), committed. Browser verification
was the next step.

## What actually happens
Using the face-paint stall wedges the park permanently. Two separate bugs stack:

1. **The panel and hint are never in the DOM.** `FacePaintStall`'s constructor
   appends them to `#ui-root`, but it runs inside `new World(...)` at
   `Game.ts:90`, and `new Hud(uiRoot)` at `Game.ts:168` does
   `this.root.innerHTML = ''`. Game.ts:166 even states the rule the stall
   broke: "The HUD clears the overlay when it is built, so everything else that
   puts DOM in there has to come after it."
   Verified in the browser: `document.querySelectorAll('.facepaint-panel').length === 0`
   and `stall.panel.root.isConnected === false`, while `stall.panel.isOpen === true`.
   So pressing E at the stall pauses the park (`syncPaused`) and shows nothing.

2. **The painting cutscene deadlocks.** `updatePaintingCutscene` advances
   `paintingElapsed` by `context.dt`, but `syncPaused()` has just set
   `gameStore.paused`, and `Game.ts:442` zeroes `frameContext.dt` while paused.
   `paintingElapsed` sticks at 0 forever, `uiOpen` stays true, park paused
   forever. Measured: still exactly 0 after 7 s. Escape closes the panel but
   cannot clear `paintingElapsed`, so it is unrecoverable (each Escape advances
   it by one frame's dt, ~0.008 s — ~190 presses to escape, and no Escape key
   on a tablet at all).
   Same class of bug `Game.ts:427` already calls out for mini-games.

## The fix
- `FacePaintStall` no longer builds DOM in its constructor: new `mountUi(uiRoot)`,
  called from `World.mountUi()` from `Game` *after* the HUD exists.
- Cutscene runs on `context.elapsed` (which Game deliberately keeps ticking
  while paused) instead of `dt`. `paintingElapsed` -> `paintingStartedAt`.
- Public `uiOpen` getter, mirroring `Shopping.uiOpen`, so Escape / ActionButton
  / SignReader stop fighting the panel.
- Panel keyboard (`handleKey`) was written but never wired to anything — wired
  via a DOM keydown listener, same pattern as `Shopping.onKeyDown`.

## Verify
Dev server on 127.0.0.1:5173. Stand point is roughly (-9.12, -2.6).
`window.game.world.facePaintStall` is the stall.
