# HANDOFF — colourwheel-scroll-hide

Branch: `fix/colourwheel-scroll-hide`, worktree `.claude/worktrees/colourwheel-scroll-hide`.

## Task

Two UX fixes to the character-creation colour picker (`src/ui/ColourWheelPicker.ts`,
used only from `buildSwatchSection` in `src/ui/CharacterCreation.ts`):
1. Scroll the wheel panel into view when it opens.
2. Hide the curated swatch buttons (not the "+" trigger) while the wheel is open.

## Status: done, build green, commit made, PR not yet opened

Commit `7a4667f` on the branch. `npm run build` exits 0 (checked properly, not
piped).

### What changed

- `ColourWheelPickerHandlers` gained an optional `onOpenChange?(open: boolean): void`,
  fired from `openWith()` (true) and `close()` (false) — never from `toggle` directly
  since `toggle` only ever calls one of those two.
- `openWith()` now does `requestAnimationFrame(() => panel.scrollIntoView(...))`
  after clearing `hidden` — the rAF matters because `scrollIntoView` on a still
  `display: none` element (this same tick) reports a zero-size rect. Respects
  `prefers-reduced-motion` the same way `characterCreationPreview.ts`'s
  `spinsAllowed` does (`window.matchMedia?.('(prefers-reduced-motion: reduce)').matches`),
  with `?? true` (instant, not smooth) as the fallback when `matchMedia` itself
  isn't available.
- `buildSwatchSection` passes `onOpenChange: (open) => { for (const button of buttons) button.hidden = open; }`
  — `buttons` is only the curated preset buttons, not `picker.trigger` (also in
  `row` but a separate array), so the trigger stays visible/reachable the whole
  time, which is also how a child would notice the picker exists at all.
- No CSS changes needed: `.charcreate-swatch` sets no `display`, so the browser's
  own `[hidden] { display: none }` UA rule applies cleanly (unlike `.colourwheel-panel`,
  which needed an explicit `[hidden]` override because it sets `display: flex`).

Every swatch section (skin, hair, eyes, outfit, backpack, shoe) goes through the
one shared `buildSwatchSection`, so all get both fixes automatically — no
per-tab special-casing needed, confirmed by reading every call site.

### Verification

- `npm run build`: exit 0, full check suite + tsc + vite build all passed.
- Live browser QA: DONE. Overseer granted chrome-devtools ownership. Ran
  `vite --port 5471 --strictPort` (own port, killed by PID afterwards),
  opened a background page at 390×700 (phone-sized, where the fold problem
  actually bites), started a fresh character:
  - Skin tab: opened "Custom colour" — panel (wheel, preview swatch,
    brightness bar, hint, Done) scrolled fully into view; the 7 curated
    presets vanished from the a11y tree, the trigger stayed and showed
    `aria-expanded=true`. Dragged the wheel to white, clicked Done: curated
    row reappeared, none of the 7 presets `pressed`, "Custom colour" trigger
    correctly `pressed`, preview character's skin updated.
  - Outfit tab (has the one two-tone "Red & White" swatch): same open
    behaviour confirmed independently — curated row hides, trigger + wheel
    visible. Closed via Escape this time (had to focus something inside the
    wheel first — Escape's listener lives on `panel`, not `trigger`, which is
    pre-existing behaviour, not something this PR touches): curated row
    reappeared, trigger `pressed` and refocused, matching `close()`'s own
    `trigger.focus()` call.
  Both open paths (click) and both close paths (Done click, Escape) checked;
  both fixes hold on two independent swatch sections.

### Status: ready for PR
