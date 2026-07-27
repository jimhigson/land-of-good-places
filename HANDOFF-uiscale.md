# HANDOFF — 1.1 minimum font size + whole-UI scaling, and 1.8

Branch: `feat/ui-scale`. Owner of `src/style.css` while this is open.

## The one decision everything inherits

```css
html { font-size: clamp(20px, 0.62vw + 0.55vh + 8px, 38px); }
```

`1rem` is **both** the minimum text size (`--lgp-text-min`) and the unit every
size in the UI is a multiple of. Floor 20px (phone/tablet), cap 38px
(ultrawide) — up to 1.9x growth. Width and height both count so a short
landscape phone is treated as small. Worked examples are in the comment at the
top of `src/style.css`.

`src/core/uiScale.ts` reads that computed value back out of the DOM
(`getComputedStyle(document.documentElement).fontSize`, cached, cleared on
resize) so canvas-painted text uses the same number — one definition, two
consumers. `minTextPx()` === `uiUnitPx()` by construction.

## Done

- `src/style.css` fully converted px -> rem (script-assisted, then hand-tuned).
  Only px left: the root clamp, `999px` pill sentinels, `@media` breakpoints,
  comments. Type-scale tokens `--lgp-text-min/sm/md/lg/xl`; every font-size at
  or below the floor became `var(--lgp-text-min)`.
- Breakpoints that merely *shrank* things deleted (shop title/buy, dex grid,
  parkmap floor label, sign-reader padding, portrait names, `.pill--soft`).
  Kept: genuine reflows (charcreate stacking, update-toast full width, short
  screen repositioning, portrait-circle squeeze, `prefers-reduced-motion`).
- `button/input/select/textarea` pinned to the floor — they do not inherit.
- 1.8: `.charcreate-card` now `min(58rem, 96vw)` / `min(46rem, 92vh)` and
  `.charcreate-controls` is `repeat(auto-fit, minmax(14rem, 1fr))` with the
  name section spanning all columns. Scrolls only when it truly cannot fit.
  **CSS only — `CharacterCreation.ts` / preview code belong to another agent.**
- `NameLabel` pill height is now derived (`minTextPx() * 160/62`) instead of a
  flat 34px, which had the name itself at ~13px. Screen-constant sizing
  (`worldUnitsPerPixel`) untouched — do not regress that.
- `SpeechBubble` scaled so its 44px canvas line lands on `minTextPx()` (was
  ~10px on screen).
- Signs: subtitle 34 -> 40px, title 52 -> 56px, both with `fillText` max-width
  so long text condenses instead of overflowing.

## Remaining

- `src/ui/ParkMap.ts`: label font `700 11px` -> `minTextPx()`, pin/glyph sizes
  scaled. Watch for label collisions at the bigger size.
- CSS-in-TS in `src/minigames/overlay.ts`, `waterFight/hud.ts`,
  `ferrisWheel/hud.ts`, `dodgems/hud.ts`, and `src/ui/DevBadge.ts`.
- `scripts/check-text-sizes.mjs` guard + `npm run check:text`.
- Rebase onto origin/main, `gh pr create`, do NOT merge.

## Known follow-ups (call out in the PR, do not fix here)

- Dodgems giggle bubbles (`minigames/dodgems/giggles.ts`) and the tree
  "TWEET!?" are world-scaled sprites, not screen-constant; item 1.3 rewrites
  that file, so leave them.
- No browser this session (shared profile owned by the P0 agent) — build
  verification only.
