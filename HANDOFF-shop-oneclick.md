# Handoff — one-click buying (GAME_DESIGN "Buying things")

**Branch:** `shop-one-click`, from `origin/main` @ 4468183.
**Status:** done, builds clean, PR raised. Needs visual QA only.

## What changed

- `src/ui/ShopPanel.ts` — rewritten. No selection state, no panel-wide Buy
  button. Each item is a `.shop-item` row (icon, name, blurb, price) with its
  own `.shop-item-buy` `<button>` beside it. One press buys.
- `src/style.css` — new `.shop-item*` rules. `.shop-row`, `.shop-buy`,
  `.shop-panel`, `.shop-card`, `.shop-head`, `.shop-close`, `.shop-hint` are
  **all shared** with FacePaintPanel, InventoryDrawer, CharacterCreation,
  ParkMap, SignReader, WhatsNew, StairMenu, CuteODex — none of them were
  touched. Only addition to a shared selector is
  `.shop-foot > .shop-hint:only-child { margin-top: 0 }`, which by
  construction only matches the shop's own footer (every other `.shop-foot`
  has a button in it too).
- `src/Shopping.ts` — doc comment only.
- `whatsnew.json` — entry 11.

## Findings worth keeping

- **The purchase path is untouched.** `onBuy(id)` → `Shopping.buy` →
  `gameStore.buy(specFor(item))`, exactly as before, so where things land is
  unchanged: `buy()` puts every carryable thing in the hands (`carriedUid`)
  and unstows toys/pets/balloons so they join the parade; everything else is
  `stowed: true` (backpack). Balloons are `kind: 'balloon'` → parade.
- **Buying a hat does not wear it** — never did. `wornHatUid` is only ever set
  by `completeCharacterCreation`. Pre-existing; left alone deliberately.
- The rainbow outline, pointer cursor and activation flash all arrive for free
  because the buy buttons are ordinary `<button>`s (global rule in
  `style.css`, delegated `click` listener in `ui/TapBurst.ts`). Verified by
  reading both; not verified in a browser (no browser ownership).
- **Enter must not be consumed** by `ShopPanel.handleKey` — `preventDefault`
  on Enter/Space stops the browser activating the focused button. That is why
  `handleKey` returns `false` for them now.
