# HANDOFF: rail-race-hud-layout

Branch `rail-race-hud-layout`, worktree
`.claude/worktrees/rail-race-hud-layout`. Task from Jim, 6 points:

1. Standings HUD (`.mg-portrait-strip[data-layout='row']`) → left edge in
   landscape, stays top in portrait (unchanged).
2. Compensate: nudge `RIDER_SCREEN_X_LANDSCAPE` in `src/world/railRace/camera.ts`
   right a little so the cart doesn't sit under the new left column. Portrait's
   `RIDER_SCREEN_X_PORTRAIT` (0.1) is a documented floor — do not touch it.
3. Fix overlaps across `.racehud-*` in both orientations, real device presets.
4. Drop the level-select description line, title only.
5. Prefer smaller text over more text (floor: `var(--lgp-text-min)` = 1rem,
   see `scripts/check-text-sizes.mjs`).
6. New brief controls-instructions message right as the level is chosen /
   countdown starts (tap-to-boost, duck), reusing `isTouchDevice()` from
   `src/core/device.ts` the same way `src/ui/Hud.ts` already swaps copy.

## Key files
- `src/ui/RaceHud.ts` — the DOM/logic layer.
- `src/minigames/portraitStrip.ts` — shared portrait-strip builder (`row` layout
  is the Rail Race's own single-bank running order).
- `src/style.css` — `.mg-portrait-strip[data-layout='row']` ~L3889-3943,
  `.racehud-*` ~L4121-4388.
- `src/world/railRace/camera.ts` — `RaceCamera`, `RIDER_SCREEN_X_LANDSCAPE`.
- `src/world/railRace/RailRace.ts` — `RaceMoment` union + `chooseLevel()`
  (levelSelect→countdown transition, where the new controls message fires).
- `src/Game.ts` L494-527 — wires `RaceMoment` → `RaceHud` calls.
- `scripts/check-rail-race.mts` — camera framing checker
  (`npm run check:rail-race`), prints "rider NN% across" per device shape.

## Status: done, PR ready

All 6 points implemented, `npm run build` exit 0 (includes `check:rail-race`,
`check:text-sizes`/`check:text`, `tsc --noEmit`, and ~20 other gates).
`npm run test:procgen` could not run locally — `vitest` binary missing from
this worktree's `node_modules` (pre-existing env issue; no procgen files were
touched by this change, so it's out of scope here).

Chrome devtools were never available this session — `list_pages` showed
other agents' pages open (and one actively `[selected]`) both times checked,
so per CLAUDE.md this agent never touched the shared profile. Everything
below is verified by build/checker output and hand-worked pixel math, not a
screenshot — flagged for a human/QA pass in the PR.

### What changed, mapped to the 6 asks
1. `.mg-portrait-strip[data-layout='row']` (standings HUD) now docks to the
   left edge in `@media (orientation: landscape)` (`src/style.css`
   ~L3955-3985); portrait untouched.
2. `RIDER_SCREEN_X_LANDSCAPE` 0.28 → 0.34 in `camera.ts`. Re-verified with
   `npm run check:rail-race`: monitor/laptop now "rider 34.0% across" (was
   28%), still inside the checker's own `0.06 < riderX < 0.36` bound, and
   `rail race: OK`.
3. Reconciled overlaps: level-select dialog got `overflow-y:auto` safety net
   + a `max-height:420px` tightening; the new controls-tip pill sits at
   `top:70%` (well clear of the countdown digit at `top:38%`, hand-verified
   against 812x375 and 844x390 real phone-landscape shapes); in landscape the
   tip is also nudged to `left:66%`/narrowed (`max-width:min(18rem,42vw)`) —
   caught by hand-checking pixel math that a *centred* tip's left edge would
   land under the new standings column on a 667x375 phone (a very common
   shape); the level-select ~ standings hide-during-select rule was already
   correct and untouched.
4. Level-select buttons: title only, `line`/`<span>` dropped from
   `RaceHud.ts`'s `LEVEL_COPY` and `.racehud-level span` CSS removed.
5. Where touched: level cards shrunk (padding, no longer two lines), controls
   tip text sized `--lgp-text-md`/`--lgp-text-min` (the floor) — nothing
   added went below `--lgp-text-min`, confirmed by `check:text-sizes`.
6. New `RaceMoment` kind `'controls'`, fired once by `RailRace.chooseLevel`
   right as the countdown starts; `RaceHud.flashControlsTip()` shows a
   fire-and-forget pill (~3.5s, same restart dance as `flashBonk`) reading
   "Tap to BOOST / Drag down & hold to DUCK" on touch or "Space or click to
   BOOST / Hold ↓, right-click or D-pad to DUCK" on desktop, via the
   project's existing `isTouchDevice()` switch (`src/core/device.ts`, same
   pattern as `ui/Hud.ts`).

### What still needs a human/QA pass
Nobody has *looked* at this. In particular: the landscape standings-column
visual balance against the cart's new screen position, and the controls-tip
pill's exact placement relative to the countdown digit and (in landscape) the
standings column, on a real portrait phone and a real landscape phone/monitor.
