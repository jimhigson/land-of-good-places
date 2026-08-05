# HANDOFF — keychain shop

> ## RESUMED 5 August 2026 — read this box first
>
> Branch is now **`feat/keychain-shop-finish`**, worktree
> `.claude/worktrees/keychain-resume`, **rebased onto current `origin/main`
> (a68ed54)**. Port 5315. `npm run build` exit 0.
>
> **Which branch was right.** The work existed on two divergent branches.
> `keychain-shop` (the one issue #119 named) had only the charms and this
> handoff. **`keychain-finish` was the fuller one** — charms, handoff, the
> additive `keychainAnchor`, and the WIP state commit `3cafe5c` — and was *not*
> a descendant of the other. Resumed from `keychain-finish`; issue #119 has
> been corrected.
>
> **The rebase was cheap, and worth doing.** 214 commits of drift, but the work
> is only ~510 lines and mostly one new file. Seven conflict hunks, every one an
> additive-vs-additive "both sides added a sibling" — no semantic fights. The
> WIP commit rebased to exactly the four type errors its own message predicted
> and introduced none.
>
> **The drift helped.** Main has since landed `wornJetpackUid`, which is a
> closer twin of what a keychain needs than `wornHatUid` ever was: a new
> `InventoryKind`, its own `worn*Uid`, a `setWorn*`, a `wearableSlot` arm, an
> `owns(...)` hydrate pass. **Mirror `jetpack`, not `hat`.** Decision 3 below
> still stands; only its template got better.
>
> **Done since resuming:** the whole state layer (handoff step 2) — `save.ts`,
> `hydrate`, `createInitialState`, `refreshPlacement`'s `isWorn`,
> `wearableSlot`. Steps 1 (anchor) and the charms were already committed.
>
> **STALE DECISION — needs a ruling before step 4.** Gotcha "the backpack
> already exists" below described *one* bag, 0.36 x 0.32 x 0.20 at
> (0, 0.56, -0.32), and `keychainAnchor` was measured against it at
> `(0.17, 0.5, -0.3)`. Since then **#131 landed five authored backpack shapes**
> (`art/models/backpacks.ts`, `buildBackpacks`, `BackpackPart`,
> `setBackpackKind`). That offset is now only known-good for a bag of roughly
> the old dimensions, and is unverified on the other four. The right home for
> the number is the bag's own rig, per shape, rather than a constant in
> `kid.ts` — flagged to the Overseer, not yet acted on. The rebase keeps the
> old offset and gates it on `backpackRig` existing.
>
> **Remaining:** steps 3–7 below, unchanged and still accurate.

Branch `keychain-shop`, worktree `.claude/worktrees/keychain-shop`, off
`origin/main` (55b9b4f, the SELECTION RULE PR #100).

**Status: NOT coherent — do not raise a PR from this as it stands.** One
commit exists: the five keychain models. Everything else below is a studied,
verified plan and not a line of code. `npm run build` is green (exit 0) with
what is committed.

## The goal

A keychain stall in the garden. Collect a keychain, and it dangles from the
player's backpack with a little sway. One equipped at a time; the collection
is remembered; swap freely at the stall or from the backpack drawer.

## Done

`src/art/models/keychains.ts` — `KEYCHAIN_KINDS`, `createKeychain(kind)`.
Five charms: RiPika head, star, strawberry, rainbow, heart. Measured:

| kind | height | bottom | scale |
|---|---|---|---|
| ripika | 0.2418 | 0.0000 | 1 |
| star | 0.2232 | 0.0000 | 1 |
| strawberry | 0.2048 | 0.0000 | 1 |
| rainbow | 0.1984 | 0.0000 | 1 |
| heart | 0.2065 | 0.0000 | 1 |

All obey the asset contract exactly, so they will pass `check:assets` the
moment they enter `SHOP_ITEMS` — with no `KNOWN_DRIFT` entry, which a new
asset is not allowed anyway.

## The decisions, and why (this is the expensive part — do not re-derive)

1. **It is a `FacePaintStall`, not a building shop.** The seven "shops"
   (`ShopId` in `world/building/shops/catalogue.ts`) are alcoves on decks
   inside the tower, fitted out through exhaustive `Record<ShopId, …>` tables
   in `shops/fitouts.ts` and `shops/Shops.ts`. `world/FacePaintStall.ts` is the
   one *garden* stall that hands something over without being a mini-game, and
   it is the sibling to copy: manifest entry → `placedEntry(...)` → booth built
   in the file → `pressZone` → a HUD panel → `World.ts` wiring. Note its
   header: it borrows placement *conventions* from `minigames/stalls.ts` and
   not one line of code, because importing `minigames/` into `world/` is
   backwards layering.
2. **Keychains are real catalogue entries.** Give `ShopItem.shopId` the value
   `'keychainStall'`, added to the union beside `'spookyHouse'` — the existing
   precedent, documented on that field, for a catalogue entry that no building
   shelf sells. `itemsForShop` then never puts one on a shelf, and the
   Cute-o-dex page, the save, the counts, the brevity check and the asset check
   all come free.
3. **Equipped = `wornKeychainUid`, exactly like `wornHatUid`.** New
   `InventoryKind` and `CuteCategory` `'keychain'`; `wearableSlot('keychain')`
   returns `'keychain'` so `ui/InventoryDrawer.ts` offers "Wear" as well —
   today it would render a keychain as an inert row, since it is neither
   `carryable` nor wearable and `actionFor` falls through to `kind: 'none'`.
   Not carryable, not paradeable.
4. **Origin at the base.** `scripts/check-asset-contract.mts` walks
   `SHOP_ITEMS` whole and grants the `'anchor'` origin reading only to ids
   beginning `hat.`. So the models stand up, and `WornKeychain` hangs one by
   offsetting `-height`. Already built this way — see the commit message.
5. **PREVIEW RULE (absolute).** A keychain changes how the character looks, so
   the picker must reuse `ui/characterCreationPreview.ts`, never be a second
   picker. Plan: an optional `keychainId` on `PreviewChoice` (omitted, never
   assigned `undefined` — `exactOptionalPropertyTypes`), a new `'backpack'`
   entry in `PreviewFocus` and `FOCUS_MARGIN`, and a `BACK_FOCUSES` /
   `BACK_TURN = Math.PI` pair in `updateTurntable` alongside the existing
   `TAIL_FOCUSES` / `TAIL_TURN`, so the plinth turns her back to the camera.
   `updateCamera` already rotates the framing centre onto the live turntable
   angle, so nothing else there changes.
6. **The deed.** `secret.keychain` in `state/secrets.ts`, fired from the first
   collect via `discoverSecret`. Cheap — one table row and one call — and it is
   the established pattern for "a thing you did".

## Gotchas found the hard way

- **`Parade.stowedIds`** (bottom of `entities/parade/Parade.ts`) skips
  `wornHatUid` / `wornFlowerUid` so a worn thing is not *also* peeking out of
  the bag. `wornKeychainUid` must be skipped there too, or the equipped
  keychain is drawn twice — once dangling, once climbing out of the backpack
  behind it.
- **Adding a manifest entry re-rolls the whole park.** `parkLayout.ts` solves
  from one shared seeded rng stream, so a new `stall.keychain` moves everything
  after it in the sort order. Bump `LAYOUT_VERSION` (currently 2) alongside it,
  and let `check:park` prove the result.
- **`check:brevity`**: a title is ≤ 24 characters, a blurb is ONE sentence of
  ≤ 50. Do not add `KNOWN_LONG` entries. Drafted copy that fits:
  `RiPika Keychain` / `A tiny RiPika for your bag.`; `Star Keychain` /
  `A little star that swings when you walk.`; `Strawberry Keychain` /
  `A tiny strawberry, never squashy.`; `Rainbow Keychain` /
  `A whole rainbow, small enough to carry.`; `Heart Keychain` /
  `A little heart bouncing on your bag.`
- **The backpack already exists.** `art/models/kid.ts` builds a bag by default
  (`backpack = true`, bag at `(0, 0.56, -0.32)`, 0.36 × 0.32 × 0.20) and
  publishes `backpackAnchor` at `(0, 0.74, -0.3)` — the *mouth*, used by
  `BackpackPeek`. Do **not** reuse that anchor: add a separate `keychainAnchor`
  low on the bag's side (about `(0.17, 0.5, -0.3)`) so the charm hangs clear of
  a peeking head.
- The `pressZone` chip label should come from `shopWords().verb`
  (`state/wording.ts`) — "Collect!" outside Mayhem — not a hard-coded word.
  Without an explicit label the id `stall:keychain` falls through
  `DEFAULT_VERBS` in `world/interact.ts` to "Play".

## The remaining work, in order

1. `art/models/kid.ts` — additive `keychainAnchor` group; expose it on
   `entities/CharacterModel.ts`.
2. `state/types.ts` — `'keychain'` into `INVENTORY_KINDS` and
   `CUTE_CATEGORIES`; `wornKeychainUid` on `GameState`. `state/store.ts` —
   `setWornKeychain` (twin of `setWornHat`), `wearableSlot`, `savedGame`,
   `hydrate` (including the `owns(…, 'keychain')` sanity pass) and
   `refreshPlacement`'s `isWorn`. `state/save.ts` —
   `SavedGame.wornKeychainUid` plus one
   `put(game, 'wornKeychainUid', readUid(value['wornKeychainUid']))`. No
   `SAVE_VERSION` bump: reading is tolerant per field.
3. `shops/catalogue.ts` — the five entries.
4. `entities/WornKeychain.ts` — copy `entities/WornHat.ts` (store subscriber,
   pop-in). Hang from a pivot `Group` on the anchor with
   `root.position.y = -handle.height`; sway is
   `pivot.rotation.z = Math.sin(elapsed * 2.1) * 0.16` and a smaller `.x`, no
   physics. Register in `entities/index.ts`, construct in `Game.ts` beside
   `wornHat`. Fix `Parade.stowedIds`.
5. `world/KeychainShop.ts` + `ui/KeychainPanel.ts` — reuse the
   `charcreate shop-panel` / `charcreate-card shop-card` / `charcreate-body` /
   `charcreate-preview` / `charcreate-controls` / `charcreate-grid` /
   `shop-row charcreate-row` classes, so no new CSS is needed. Then the preview
   change from decision 5, and the `World.ts` / `Game.ts` wiring (`mountUi`,
   `interactZones`, `update`, `dispose`, and the three `uiOpen` checks in
   `Game.ts` around lines 489, 531 and 677).
6. `parkManifest.ts` entry — `footprint: { kind: 'circle', radius: 2.8 }`,
   `boundingRadius: 3.6`, `band: { min: 13, max: 30 }`, exactly like
   `stall.facePaint` — plus the `LAYOUT_VERSION` bump.
7. `ui/CuteODex.ts` — a `{ category: 'keychain', title: 'Keychains',
   glyph: '🔑' }` section. `whatsnew.json` — one entry at id 15.

## Parallel work to expect

- **`hat-sizing`** is in the player-model area and its scope has grown to
  include rebuilding the long-hair model. Every edit here to
  `art/models/kid.ts` must stay strictly additive — one new anchor `Group`, and
  nothing touching the hats, the hair rig or `hatAnchorHeight`. Say so in the
  PR when it is eventually raised.
- **PR #101** pins the park's plots. On main the solver places everything, so
  `stall.keychain` is an ordinary un-pinned entry in the 13–30 m band like its
  siblings; when #101 merges it will solve around the pins with no change here.
