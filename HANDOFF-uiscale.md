# HANDOFF — 1.1 minimum font size + whole-UI scaling, and 1.8

Branch: `feat/ui-scale`, rebased on `origin/main`. Owner of `src/style.css`
while this is open. **Work is complete and pushed; only review/QA remains.**

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

## What landed (3 commits)

1. **Root scale + style.css.** Whole file px -> rem. Only px left: the root
   clamp, `999px` pill sentinels, `@media` breakpoints, comments. Type scale
   `--lgp-text-min/sm/md/lg/xl`. Breakpoints that only *shrank* things are
   deleted; genuine reflows kept. `button/input/select/textarea` pinned to the
   floor (they do not inherit). Canvas text: `NameLabel` (was ~13px on
   screen), `SpeechBubble` (~10px), sign subtitle 34 -> 40px with `fillText`
   max-width. **1.8**: `.charcreate-card` is `min(58rem, 96vw)` /
   `min(46rem, 92vh)` and `.charcreate-controls` is
   `repeat(auto-fit, minmax(14rem, 1fr))` with the name spanning all columns.
2. **Everything else + the guard.** Park map labels (they were painting at the
   canvas default 10px — the font string named a CSS var, which a canvas
   cannot resolve) plus collision-skipping; mini-game HUD CSS-in-TS; DevBadge;
   `scripts/check-text-sizes.mjs` wired as the first step of `npm run build`.
3. **Dodgems word art.** Giggles (~6px) and the bird's "TWEET!?" (~15px) now
   scale from the dodgems camera's `worldUnitsPerPixel`, like name pills.

## Rules honoured

- CSS only in character creation — `CharacterCreation.ts` and
  `characterCreationPreview.ts` belong to the concurrent 1.5/1.7 agent.
- Name labels keep their screen-constant sizing; the zoom-out fix is intact.
- `npm run build` run and exit code checked after every chunk (never piped).
- No browser: shared profile is the P0 agent's this hour. Build-verified only;
  the PR lists what to look at and at which sizes.

## If you take this over

Nothing outstanding. If review asks for changes, the levers are: the clamp on
line 37 of `src/style.css` (floor/cap/coefficients), the type-scale tokens
just below it, and `.charcreate-controls`'s `minmax(14rem, 1fr)` for how
eagerly character creation splits into columns.
