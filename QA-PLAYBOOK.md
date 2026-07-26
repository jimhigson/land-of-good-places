# QA Playbook — Land of Good Places

The standing checklist for the QA role (a Sonnet agent instantiated per
review). Any QA agent reads this first, runs what's relevant, appends new
regression checks when bugs are found, and reports pass/fail per item.
The Overseer has final say on every merge; QA sign-off covers the routine.

## How to run a QA pass

1. `npm ci` (if worktree) and `npm run build` — must be green, zero TS errors.
2. `npm run dev`, open ONE Chrome page via the chrome-devtools MCP tools.
   Test on desktop viewport AND an emulated touch phone (390×844).
3. Console must stay clean (no errors or warnings) through the whole pass.
4. BROWSER HYGIENE: one page max; close it and kill the dev server when done.
5. Report pass/fail per checklist item + screenshots of anything suspicious.

## Core regression checklist (run on every PR)

- Game loads to a walkable park; player moves with WASD and tap-to-move.
- Hop works (Space + touch button) and shows the rainbow ring.
- Double-tap runs; single tap walks; manual input cancels navigation.
- Open + close the backpack drawer via every close path → tap-to-move,
  hop and pinch zoom STILL WORK afterwards. (Regression: the backpack
  input-freeze bug, 26 Jul 2026.)
- Open + close a shop panel the same way; buy an item by tap and keyboard.
- Parade: with 2+ paradeable items owned, the line follows, hops on hop.
- Enter and leave the building; ride at least one traversal (lift/stairs).
- Enter and exit one mini-game; the park resumes intact (position, HUD).
- Day/night clock advances; name label stays constant size across zoom.
- Draw calls at default garden view: report the number; flag if > 500.
- fps: report; flag if under ~50 on desktop.

## Feature-specific checks

Added per feature as they ship — see PR descriptions for acceptance
criteria. Notable standing ones:

- **Rail Racer**: NOT holding under a barrier must NEVER bonk; look-ahead
  must match between portrait and landscape within ~10%.
- **Ball pit**: balls settle (no perpetual jiggle), splash wave on slide
  landing, no NaN/exploding balls after 60s of wading.
- **NPCs**: watch 60s — no wall clipping, no stuck clusters; wave when
  approached.

## Escalation rules

Escalate to the Overseer (don't sign off) when: a check is ambiguous, a
fix would change design/game-feel, art quality is in question, performance
regresses meaningfully, or the PR touches files outside its stated scope.

## Open follow-ups (from the UI batch, 26 Jul 2026)

- Name label: empirically screenshot at min AND max zoom (constancy is
  guaranteed by construction — worldUnitsPerPixel on ortho — but grab the
  screenshot pair once: art/renders/ui-batch-labels.png).
- Touch hint variant: on an emulated touch phone, the "?" hint must show the
  touch wording, not the keyboard wording (isTouchDevice() branch).
- sign-19 (outdoor sign near spawn, x=-6 z=-8): inspect mode frames it wrong
  (shows a path close-up). Placement/registration quirk — investigate.
- Sign inspect: empirically confirm tapping a DIFFERENT sign mid-inspect
  switches to it (verified by code reading only).

## Log

- 2026-07-26 — playbook created. Regression seeds: backpack input-freeze,
  racer bonk rule, ball-pit convergence.
- 2026-07-26 — UI batch verified (2 verifier sessions, handoff-file recovery):
  backpack fix 9/9 twice, shop panel 9/9, double-tap all 3 cases, ? button,
  sign inspect incl. re-entry. Follow-ups above.
