# HANDOFF — fix/face-paint-crash (P0)

## Status
Done: fixed, built green, verified in the browser, PR raised. Do not merge —
the Overseer merges after review.

## Root cause (the bit worth keeping)
Using the face-paint stall froze the park permanently. Two bugs stacked, and
either one alone would have looked like "the game hangs":

1. **The picker was never in the document.** `FacePaintStall`'s constructor
   appended its panel and hint to `#ui-root`, but it runs inside
   `new World(...)`, and `new Hud(uiRoot)` — eighty lines later in `Game`'s
   constructor — starts with `this.root.innerHTML = ''` and deleted them. The
   comment directly above that line states the rule that was broken. Measured
   live: `document.querySelectorAll('.facepaint-panel').length === 0` while
   `stall.panel.isOpen === true`. So pressing interact paused the park and
   showed nothing at all.

2. **The painting cutscene could never end.** `updatePaintingCutscene`
   advanced `paintingElapsed` by `context.dt`, but this object had just paused
   the game and `Game.update` zeroes `frameContext.dt` while paused. Measured:
   `paintingElapsed` still exactly `0` after 7 seconds. `uiOpen` stayed true
   forever. Escape closed the panel but could not clear `paintingElapsed`, so
   there was no way out at all — and no Escape key on a tablet regardless.

A third defect turned up while verifying the NPC call site: painted children's
decals were placed by subtracting the stall group's position but ignoring its
`rotation.y`, so the paint floated up to ~10 m away from the child, over open
grass. Fixed too (`stallToLocal`).

## Verified in the browser
Hint appears near the booth; E opens a visible picker; arrows + E pick
(keyboard was dead before — `handleKey` had no caller); the cutscene finishes;
the design lands on the player's head; Escape closes and the park resumes at
~120 fps; wash-off clears it and re-enables correctly. NPC decals track their
child with 0.000 m error while walking, at 19–35 m from the booth, where the
old code was 5.7–10.3 m out. Console clean.

## Note for the Overseer
My first commit (`2996aab`) accidentally landed on the shared checkout's local
`main` — that checkout was moved onto another agent's branch under me while I
worked. `feat/ui-scale` was then branched from it, so **that branch carries a
copy of the face-paint fix in its history**. This PR is the rebased, canonical
version. Local `main` was reset back to `origin/main`; nothing was pushed.
