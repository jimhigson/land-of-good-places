# Handoff — character-creation owner

**Branch** `charcreate-owner`. **Worktree** `.claude/worktrees/charcreate-owner`.
**Role**: persistent owner of `src/ui/CharacterCreation.ts` and everything it
wires together. This role continues across sessions — Overseer routes future
character-creation work here.

## Status right now (31 July 2026, second session — updated at end of session)

Eight numbered pieces of work this session across many commits (hashes cited
below are post-rebase — see the note further down; run `git log --oneline`
for the current list rather than trusting a count here). `npm run build`
exit 0 (checked directly, never piped) after every one. **No PR opened yet**
— staying alive for more direction, per brief. In order:

1. **The "Look" HUD pill** — reopen the creator mid-game without losing the
   park. Reload-based v1; see the long entry below for why a live re-skin
   path doesn't exist yet and the one known wart (duplicate hat/pet grant on
   repeat reopens).
2. **Tabbed the creator** (Skin/Hair/Eyes/Outfit/Shoes/Hat/Backpack/Pet),
   generalising the PREVIEW RULE's camera mechanism via `CharacterPreview.
   setResting()`.
3. **Prepped Mohican/hat mutual exclusivity** ahead of the `mohican`
   `HairStyle` landing — built the whole mechanism against an empty
   `HAT_EXCLUSIVE_HAIR_STYLES` set so it would compile and be ready.
4. **Wired `ShoeKind` end to end**: a Shoes tab, state/save/store fields,
   `Player.ts`, NPC crowd rolling and instancing.
5. **Coordinator verified checkpoint 1–4 in the browser** — Shoes tab, Look
   pill and tabs all confirmed working, no issues. One flag: Sparkly shoes
   ignore the colour swatch (fixed pink glitter regardless of the selected
   swatch) — confirmed intentional (`shoes.ts`'s `FOOT_COLOUR`, same
   RiPika-keeps-its-own-colours precedent the backpacks already use), noted
   with a comment at the shoe-colour section rather than changed.
6. **Mohican landed for real** (PR #138, `feat/mohican-hair`, "Rooster" in the
   picker) — rebased onto it (clean, no conflicts), then activated the
   exclusivity mechanism: `HAT_EXCLUSIVE_HAIR_STYLES` is now
   `new Set<HairStyle>(['mohican'])` instead of empty.
7. **Coordinator's live QA on step 6 found a real bug**, pinned exactly with a
   screenshot: the Hat tab correctly disappeared, but the worn hat stayed
   visibly rendered and the crest never showed. Root cause — `applyHairStyle`
   called `refreshPreview('hair')` (a one-shot read of `this.hatId`) *before*
   `this.hatId` was set to `null`/restored a few lines later, so the 3D
   preview always rendered one step stale. The hidden crest wasn't a second
   bug: `setHatWorn(true)` was still firing (a hat asset was still being
   built from the stale id), which tucks hair away under a hat exactly as
   designed for every other style — it was just tucking away a crest that
   should have had no hat to tuck under at all. Fixed by resolving every
   field (`hatId`, `hatIdBeforeExclusiveHair`, the tab button, the rebuilt
   Hat panel) *before* the single `refreshPreview` call, moved to the end of
   the method. Traced both directions by hand (entering Mohican, leaving it,
   and starting the screen already on it) — all three now flow through the
   one corrected call. **Still not visually confirmed by anyone** — I do not
   have browser access this session either; the coordinator said they'll do
   their own pass regardless.
8. **Coordinator found a second bug by code reading** (browser was busy with
   the artist agent's own Stage A verification): Spiky hair never rendered in
   the creator at all, and — once traced further — the same mechanism would
   have tucked Spiky away the moment *any* hat was worn over it in real
   gameplay too, which is backwards (Jim: "just allow any hair other than
   rooster with a hat, and disable the hat, not the hair in this case"). This
   was a real design inversion, not a one-line fix: `hair.ts`'s `apply()` no
   longer hides anything for `hideUnderHat` reasons — hair is always fully
   drawn — and a new live `hidesHat`/`hairHidesHat` getter (`HairRig` →
   `KidHandle` → `CharacterModel`) is what `entities/WornHat.ts` (real
   gameplay) and `ui/characterCreationPreview.ts` (the creator) both now
   check **before** attaching a hat mesh at all. `wornHatUid`/inventory/
   Cute-o-dex are untouched — a hat still shows as "worn" in the backpack
   drawer even while nothing is drawn over Spiky. `KidHandle.setHatWorn` kept
   its name and signature for every external caller but now only re-measures
   height; it no longer tells hair anything. Full details and every touched
   file in commit `f9573e9`. `check:hair`/`check:hat-fit` both pass with
   numbers identical to before the change (their scripts already hid hair by
   hand, never relied on the removed tucking side effect).
9. **Coordinator verified step 8 live, then Jim refined the rule further**:
   spiky and a hat should both show together after all — clipping included —
   not have the hat disable itself. **Only Mohican keeps the hides-hat
   behaviour now.** The coordinator made this change directly (small: one
   flag), committed straight to this branch as `80cccc4` ("Allow spiky hair
   and a hat to show together, clipping included") — verified live by them,
   spikes visibly poking through the party hat's brim. I pulled it (same
   worktree, same branch, nothing to merge) and swept the rest of the codebase
   for my own now-stale "Spiky" references the coordinator's commit had not
   touched — found and fixed four (`entities/WornHat.ts`'s class doc comment,
   `entities/CharacterModel.ts`'s `hairHidesHat` doc comment, `Game.ts`'s
   `WornHat` construction comment, `scripts/measure-hat-fit.mts`) plus this
   file's own "Needs eyes" list below, which had been telling the next tester
   to expect the *old*, now-wrong behaviour. `hair.ts`'s `HairPart.
   hideUnderHat` is `true` for Mohican only now; spiky's `add()` call carries
   no trailing boolean at all (defaults to `false`).

**Rebase note:** step 6's rebase onto `feat/mohican-hair` rewrote every
commit's hash from steps 1–5. Use `git log --oneline` for current hashes
rather than anything cited from memory of an earlier checkpoint.

**Visually verified: steps 1–4 and 9/spiky (by the coordinator); step 6/7
(Mohican) not yet at all.** Everything marked "needs eyes" below is real and
outstanding.

### Needs eyes (manual QA)

- **Mohican — fixed once (step 7), unverified since, and now the *only*
  style with hides-hat behaviour (step 9 narrowed it from two styles to
  one).** Pick a distinct hat in the Hat tab, switch to Rooster (Mohican) in
  the Hair tab, confirm the hat visibly comes off **and the crest shows**
  (both symptoms of the bug fixed in step 7); switch to a different hair
  style, confirm the hat visibly returns and the Hat tab shows it selected
  (not reset to the default).
  Then the edge case: open the creator with Mohican already selected
  (nothing to switch away from) and confirm the Hat tab is simply absent
  from the start, no flash of it appearing first.
- **Tabs**: does the strip wrap sensibly on a phone width without becoming a
  second scroll hunt (reuses `.charcreate-styles`'s existing grid, which
  already solved this for the hair-style row, so it should); does each tab's
  camera framing look right the instant you switch to it, before touching any
  control inside. (Coordinator confirmed the desktop/basic case already;
  phone-width specifically is still unconfirmed.)
- **The "Look" pill's known wart**: reopening and re-picking the same hat/pet
  grants a *second* copy — not a data-loss bug, just clutter. Left
  deliberately; worth confirming it's actually as harmless in practice as it
  looks on paper (e.g. does a duplicate pet in the parade look buggy to a
  six-year-old even though nothing is lost).

## Status as of end of first session (31 July 2026)

Rebased cleanly onto `origin/main` at the top of this session — PR #131
(backpack picker) and PR #132 (cap redesign, RiPika/Trilla hoods, shoe assets)
are both merged, `git rebase origin/main` had zero conflicts. Two pieces of
work landed on this branch since, each its own commit, `npm run build` exit 0
(checked directly, never piped) after both:

1. **`42e61bb`** — the urgent one, requested mid-session while Eleri was
   playing live: a "Look" pill in the HUD menu (`ui/Hud.ts`) that reopens the
   character creator from inside a running game **without** losing the park.
   Investigated first whether the existing per-item live-reskin path
   (`entities/WornHat.ts` swaps a hat mesh on the anchor live, driven by a
   store subscription) could back a *full* creator reopen — it cannot: the
   running `Player`'s `CharacterModel`/`KidHandle` is built once, in
   `Player`'s constructor, from whatever the store held at that moment, and
   nothing calls the `setSkinColour`/`setHairColour`/`setOutfitColour`/
   `setHairStyle`/`setBackpackKind` setters `CharacterModel` already exposes
   against the *live* player anywhere outside the creator's own preview kid.
   Wiring that up for real (subscribe `Player` to the store, call every one of
   those setters, rebuild the name label, handle a hair-style mesh swap
   mid-walk-cycle) is a real feature, not a same-session fix. So: reload-based
   v1, exactly as the brief allowed for. `Game.reopenCharacterCreator()`
   flushes the autosave (`SaveSystem.flush()`, already existed for
   pagehide/beforeunload), sets a `sessionStorage` flag
   (`state/save.ts`'s `markReopenCharacterCreator`), and reloads. `main.ts`'s
   `boot()` reads and clears that flag
   (`consumeReopenCharacterCreator`) before the usual `ContinueOrRestart`
   check, and if set, hydrates the store from the existing save (money,
   inventory, Cute-o-dex, park name, `save.place` all survive — same call
   `continueGame` makes) then opens `CharacterCreation` straight into that
   hydrated store, **never** touching `clearSave()`. Finishing launches back
   into `save.place`, not the default spawn.
   **Known, accepted wart**: `completeCharacterCreation()` grants a fresh copy
   of the chosen hat and pet every time it runs (`grantFree`, unconditional
   push + uid mint) — reopening and pressing "Let's go!" again, even with the
   same hat/pet picked, adds a second copy to the inventory/parade rather than
   reusing the first. Does not lose anything and costs no money either mode,
   but is visible clutter (two identical pets trailing her) if she reopens the
   creator more than once. Flagged rather than fixed under the "ship the
   simplest thing that cannot lose progress" instruction — the fix (skip
   `grantFree` when the picked id matches what she already owns/wears) is
   small if it turns out to bother her.
   **Not visually verified** — did not own the shared Chrome profile this
   session (CLAUDE.md's rule), and it was not clear anyone had handed it to
   me. Needs a manual check: open the HUD menu mid-game, tap "Look", confirm
   it reopens the creator, finish it, confirm the park (money/backpack/where
   you were standing) is unchanged and you land back in the same place.

2. **`07f4ffe`** — reorganised `CharacterCreation.ts` into tabs, one per
   customisation category (Skin/Hair/Eyes/Outfit/Hat/Backpack/Pet — Name stays
   outside the strip, above it), requested right after #1 landed. Each tab
   reuses the exact section(s) the screen already had — no `onPick` logic
   changed anywhere. The actual mechanism: `characterCreationPreview.ts`'s
   `CharacterPreview.resting` field, previously fixed for a screen's whole
   lifetime (`'all'` for the creator, `'face'` for the face-paint stall, set
   once at construction from `PreviewFraming`), is now mutable via a new
   `setResting(focus)` method the tab strip calls on every switch — so opening
   a tab moves where the camera *rests*, not just where a lone control's
   transient zoom eases back to. Every existing tab's control(s) already
   agreed on one `PreviewFocus` before tabs existed (documented in
   `TAB_META`'s doc comment), so this needed zero new camera tuning.
   `.charcreate-controls` dropped its `columns: 13rem` multi-column layout
   (solved "many tall stacked sections", which a one-panel-at-a-time tab strip
   makes moot) for a plain flex column with a `max-width` cap; had to also fix
   `FacePaintPanel.ts`'s `.facepaint-controls` override (shares the
   `.charcreate-controls` class, has no tabs, was picking up the new cap as an
   unwanted side effect) and the phone-portrait breakpoint. **Also not
   visually verified** for the same reason as #1 — build/type-check is the
   only verification so far. Worth an eye on: does the tab strip wrap sensibly
   at phone width without becoming a second scroll hunt (it reuses
   `.charcreate-styles`'s existing `auto-fit, minmax(4rem, 1fr)` grid, which
   is exactly what already avoided the hair-style row's own historical
   overflow bug, so it should, but confirm).
   **Shoes intentionally not added as a tab** — see below, that's the next
   piece of work and `TAB_META` makes adding it a one-line entry once shoe
   state exists.

## Shoe assets: now real (confirmed this session)

`src/art/models/shoes.ts` exists on `main` (landed in PR #132, merged). Reread
the file directly rather than trusting the "expected" section below — it was
written before the file existed and differs in the details:

```
export type ShoeKind = 'plain' | 'ripika' | 'sandal' | 'sparkle';
export const SHOE_KINDS: readonly ShoeKind[] = ['plain', 'ripika', 'sandal', 'sparkle'];
export const CROWD_SHOE_KINDS: readonly ShoeKind[] = ['plain', 'sandal'];
export function buildShoes(options: ShoeOptions): ShoeRig { … }  // line ~495
```

So: four kinds, not the three-or-so guessed at below (`sneaker`/`sandal`/
`sparklyPink` was the guess; the real names are `plain`/`ripika`/`sandal`/
`sparkle`). `ripika` is presumably the RiPika-themed one the "collar/strap"
colour-handling note below was written for — **confirm against the real file**
before assuming that pattern holds; do not assume the names verbatim below are
right, this paragraph is the correction.

The rest of this section (the original "not landed yet" note, kept for the
git-archaeology trail) follows below.

- Branch `animal-hat-heads` (worktree `.claude/worktrees/animal-hat-heads`,
  **local only, not pushed to `origin`**) is the Blender artist's branch. As of
  this session its whole history (`38aed39` HEAD) is about **hats/hoods** —
  the RiPika/Trilla critter hoods and the Cheery Cap
  (`HANDOFF-animal-hat-heads.md` on that branch documents exactly that work).
  No shoe commit, no `src/art/models/shoes.ts`, nothing matching `*shoe*`
  anywhere in that worktree, tracked or untracked (`git status --short` there
  is clean but for a `scratchpad/` dir).
- Checked twice, ~15 minutes apart with a fresh `git fetch origin` each time.
  Nothing changed. **Re-check `git -C .claude/worktrees/animal-hat-heads log
  --oneline` (or `git fetch origin && git log origin/animal-hat-heads` once
  it's pushed) before starting the actual build** — this note may be stale by
  the time it's read.
- There is currently **no shoe customisation of any kind** in the game: feet
  are a single hard-coded blob per leg in `kid.ts` (see below), coloured from
  one fixed constant. `grep -n -i shoe` across `CharacterCreation.ts`,
  `characterCreationPreview.ts`, `state/types.ts`, `state/store.ts`,
  `state/save.ts` returns nothing but an unrelated comment. This is a wholly
  new feature, not an extension of an existing picker.

## The template: PR #131 `backpack-picker` (OPEN, not yet merged)

This is the load-bearing precedent — same shape of feature (a body-part choice
with its own kind *and* colour, chosen once in the creator, not bought in a
shop), built four days ago by the same kind of agent. I read it end to end
(`gh pr view 131`, plus `git diff main backpack-picker` across every touched
file). **Build the shoes feature as "one more of these."**

### Files it touched, and the pattern in each

1. **`src/art/models/backpacks.ts`** (new file) — the shape catalogue.
   - `export type BackpackKind = 'satchel' | 'bubble' | 'heart' | 'ripikaHead' | 'trillaHead'`
     and `export const BACKPACK_KINDS: readonly BackpackKind[]`.
   - `export const CROWD_BACKPACK_KINDS` — the subset a **background NPC** may
     wear (excludes the two creature heads: each one is a whole extra face +
     mesh set on the instanced crowd prototype, measured at 44→48 draw calls
     for the three sewn shapes vs. 44→65 if the creature heads were included —
     see `NpcSystem.ts`/`kidCrowd.ts` below).
   - `buildBackpacks(options): BackpackRig` — `options.body` (the kid's `body`
     group), `bagMaterial`/`bagDarkMaterial` (already-built `Material`s, colour
     applied by the caller), `kind` (worn), optional `kinds` (built-but-hidden,
     for the crowd prototype). Returns `{ parts, anchor, setKind }`.
     - Each piece is added **lazily** — `add(kinds, make)` only builds a mesh
       if some *wanted* kind uses it. Critical: the creator's preview rebuilds
       the whole kid on every single tap, so a version that built all five
       shapes and hid four would extrude a RiPika head and a singing puff on
       every swatch click, on a phone.
     - Every `BackpackPart` is `{ mesh, kinds: readonly BackpackKind[] }` so
       `setKind` can show/hide by membership, and so `kidCrowd.ts` can map
       prototype meshes to per-instance hidden lists without knowing what a
       strap is.
     - Colour handling for the two creature-head shapes: **the creature keeps
       its own colours** (RiPika is yellow, Trilla is pink — repainting either
       one purple would produce someone else, not a purple RiPika); the chosen
       colour instead paints a **collar/strap** the creature is strapped into,
       via a shared `collar(material)` helper. The three sewn shapes take the
       colour directly.
   - Face patches on the creature-head shapes are **renamed**
     (`backpack.facePatch`) so preview/crowd code that finds "the" face by
     name (`facePatch`) doesn't grab the bag's face instead of the kid's own.

2. **`src/art/models/kid.ts`** — wiring into the body.
   - The old inline four-mesh block (bag/flap/two straps) is deleted and
     replaced with one call: `backpack ? buildBackpacks({ body, bagMaterial,
     bagDarkMaterial, kind: backpackKind, ...(backpackKinds && { kinds:
     backpackKinds }) }) : null`.
   - `KidOptions` gains `backpackKind?: BackpackKind` (worn) and
     `backpackKinds?: readonly BackpackKind[]` (crowd-only, twin of the
     existing `hairStyles?`).
   - `KidHandle` gains `backpackParts: readonly BackpackPart[]` (twin of
     `hairParts`) and `setBackpackKind(kind): void`. Note: **no re-measure of
     `height`** on a kind switch — every backpack shape sits low enough on the
     back that none of them can be the tallest point, so `setBackpackKind`
     skips the `visibleTop` walk `setHairStyle`/`setHatWorn` both pay.
   - `backpackAnchor` (the "peeking creature" anchor,
     `entities/parade/BackpackPeek.ts`) now **moves with the shape** — each
     kind has its own mouth position in a `MOUTHS` table in `backpacks.ts`,
     because a creature-head bag opens above its ears, higher and further back
     than a sewn bag's rim.
   - Also exported for the first time: `SKULL_RADIUS` and a `KID_FACE` const
     bundling every `createFacePatch` parameter — both needed by the new
     `scripts/check-hair.mts` (see below). **Shoes won't need either**, but
     worth knowing they're there if a shoe check ever needs the skull.

3. **`src/ui/CharacterCreation.ts`** — the picker itself.
   - New `BACKPACK_OPTIONS: Record<BackpackKind, {label, glyph}>` (a `Record`
     over the *whole* union, not a list — so a kind added to `backpacks.ts` and
     forgotten here fails to compile, catching exactly the "exists in the game,
     unreachable in the UI" bug class) + a `BACKPACK_ORDER` list + a derived
     `BACKPACKS` array (ordered ones first, anything missing swept to the end).
   - **New generic helper `buildChoiceSection<T extends string>(label, choices:
     Choice<T>[], initial, onPick)`** — lifted out of what used to be the
     hair-style section's bespoke markup, because backpack shape needed the
     *identical* glyph-grid-of-buttons UI. **This is already generic and ready
     to reuse for shoes with zero changes** — `buildChoiceSection('Shoes',
     SHOES, this.shoeKind, (kind) => {...})`.
   - `buildSwatchSection` (curated swatches + `ColourWheelPicker` "+" tile) is
     **unchanged, reused as-is** for `Backpack colour` — same for shoe colour.
   - Two new sections appended to `controls`: `Backpack` (kind) then `Backpack
     colour`, positioned right after `Clothes colour` and before `Starting
     hat`. Shoes should slot in the same neighbourhood — after clothes/backpack,
     before the hat/pet cards (which are catalogue-driven `ShopItem` cards, a
     different `buildCardSection` helper — **shoes are not shop items**, they
     follow the backpack pattern, not the hat pattern).
   - `refreshPreview()` and `complete()` both pass the two new fields straight
     through — no special-casing.

4. **`src/ui/characterCreationPreview.ts`** — the PREVIEW RULE compliance.
   - `PreviewChoice` gains `backpack: BackpackKind` and `backpackColour:
     number` (non-optional — "always a real choice", same as `hairStyle`).
   - `PreviewFocus` gains `'backpack'`; `FOCUS_MARGIN` gets an entry (`1.2`).
   - `boxFor()` gets a `'backpack'` branch: measures only the **visible**
     `kid.backpackParts` (visibility-filtered, because `expandByObject` ignores
     `.visible` and would frame a hidden RiPika head).
   - **The turning plinth.** A backpack sits directly behind the child — unlike
     the ponytail (`TAIL_TURN`, 63°, added when `trailingHair` and a body-ish
     focus is active), which is only partly hidden. So backpack gets its own
     `BACK_TURN = 2.2` rad (~126°), driven by a `backShow` blend that is 1 only
     when `focus === 'backpack'`, and **added to** (not replacing) the tail
     turn's contribution in `stage.rotation.y` — the two are mutually exclusive
     in practice (`backpack` isn't in `TAIL_FOCUSES`) but the code doesn't rely
     on that, it just adds both blended terms.
   - **For shoes this is almost certainly unnecessary** — feet are on the
     *front* of the child, visible from the default view exactly like the
     `body`/clothes framing already is. A `'feet'` (or `'shoes'`) `PreviewFocus`
     should very likely just reuse the existing front-on camera with a tighter
     `FOCUS_MARGIN`, no new turntable behaviour. Confirm this by eye once
     something is built rather than assuming — but don't build a turn unless
     the preview actually needs one.

5. **`src/state/types.ts`** — `export const BACKPACK_KINDS = [...] as const;
   export type BackpackKind = ...`, plus `PlayerState.backpackKind:
   BackpackKind` and `.backpackColour: number` (both non-optional on the live
   state — a save file's fields are optional, the live state always has a
   value). Doc comment explains *why* the union is re-declared here rather
   than imported from `art/models/backpacks.ts`: `state/` never imports
   `art/` (an existing import-boundary rule), and a save file read off disk is
   untyped at runtime and needs a validatable list independent of the art
   module.

6. **`src/state/save.ts`** — `SavedPlayer.backpackKind?: BackpackKind` /
   `.backpackColour?: number` (optional — old saves won't have them),
   `readPlayer()` reads them with `readMember(value['backpackKind'],
   BACKPACK_KINDS)` / `readColour(...)`, both tolerant of garbage/absence.

7. **`src/state/store.ts`** — `CharacterCreationChoice` gains the two fields;
   `completeCharacterCreation()` writes them onto `state.player`; the
   save-hydration overlay (`if (p.backpackKind !== undefined) next.player.
   backpackKind = ...`) applies them on load, tolerantly; `createInitialState()`
   seeds defaults (`backpackKind: 'satchel', backpackColour: PALETTE.backpack`).

8. **`src/state/index.ts`** — re-exports `BackpackKind` as a type.

9. **`src/core/palette.ts` / `src/art/style/artPalette.ts`** — the default
   colour (`ART.kidBackpack`) **moved down** into `PALETTE.backpack`, with a
   comment explaining why: the store needs to name a starting colour for a
   brand-new character and `state/` can't reach into `art/` to get it. Any
   default shoe colour needs the same move — put it in `PALETTE`, not `ART`,
   from the start (saves the churn backpack went through).

10. **`src/entities/Player.ts`** — the real, in-park player's `createKid(...)`
    call gains `backpackKind: playerState.backpackKind, backpackColour:
    playerState.backpackColour` in its options object — the store's saved
    choice flowing into the actual character model.

11. **`src/entities/npc/NpcSystem.ts`** — NPC randomisation.
    - **A dedicated `Rng` stream**: `const bagRng = new Rng(NPC_SEED +
      90210)`, separate from the main `rng` (colours/hair/pace), the
      `nameRng`, etc. Comment explains why: bag *colour* already comes off the
      main stream (`pickColours`), so if shape came from the main stream too,
      adding this feature would have reshuffled every other roll for every
      NPC — different hair, different pace, different position on the path —
      the day it merged. **Shoes need their own stream on the same principle**,
      e.g. `const shoeRng = new Rng(NPC_SEED + <some other salt>)` — pick a
      salt that doesn't collide with `424242` (names) or `90210` (bags).
    - `CROWD_BACKPACK_KINDS[bagRng.int(0, CROWD_BACKPACK_KINDS.length - 1)] ??
      'satchel'` picked once per spawned NPC, passed into `this.kids.spawn(...,
      backpack)`.

12. **`src/entities/npc/kidCrowd.ts`** — the instanced-crowd machinery.
    - `PROTOTYPE_BACKPACK: BackpackKind = 'satchel'` — what the (invisible,
      geometry-only) prototype instance is built wearing; irrelevant to what
      renders, since visibility is per-instance, but named rather than a bare
      string.
    - Constructor passes `backpackKind: PROTOTYPE_BACKPACK, backpackKinds:
      CROWD_BACKPACK_KINDS` into `createKid(...)` so the **one shared
      prototype geometry** carries every crowd-eligible shape at once.
    - `hiddenBags: ReadonlyMap<BackpackKind, readonly number[]>` built once,
      analogous to the existing `hiddenParts` (hair): for each crowd kind, the
      indices of prototype meshes that kind must hide (i.e. every part whose
      `kinds` doesn't include it).
    - `spawn(colours, hairStyle, scale, eyeVariant, backpack =
      PROTOTYPE_BACKPACK)` — new trailing parameter, applies `member.shown[part]
      = 0` for each hidden index, exactly like the hair-style hiding loop right
      above it in the same function.

13. **`scripts/check-asset-contract.mts`** — one `add('kid.backpack.${kind}',
    createKid({ backpackKind: kind }))` per `BACKPACK_KINDS` entry, proving no
    shape moves the kid's origin, facing or measured height. **Do the same for
    shoes**: `for (const kind of SHOE_KINDS) add('kid.shoe.${kind}', createKid({
    shoeKind: kind }))`.

14. **`scripts/check-hair.mts`** (new script this PR also introduced, mostly
    unrelated to backpacks but touches them once): the hand/hair-clearance
    sweep is extended to check hair against **every** backpack shape, not just
    the satchel, because a bigger bag is a bigger thing for trailing hair to
    clash with. **Shoes are on the feet, nowhere near hair** — I don't expect
    this script needs touching for shoes. If a shoe shape ever has something
    tall enough to reach hair (it won't), reconsider.

### One important scheduling note

**Backpack-picker (PR #131) is not merged yet.** It touches nearly every file
the shoes feature will also touch: `CharacterCreation.ts`, `kid.ts`,
`state/types.ts`, `state/save.ts`, `state/store.ts`, `state/index.ts`,
`characterCreationPreview.ts`, `Player.ts`, `NpcSystem.ts`, `kidCrowd.ts`,
`check-asset-contract.mts`. Building shoes against current `main` and then
rebasing onto backpack-picker post-merge means resolving a conflict in nearly
every one of those files by hand. **Two options, pick when shoe assets land:**
- If PR #131 has merged to `main` by then: branch shoes off fresh `origin/main`
  as normal — clean, no conflict.
- If it's still open: consider branching shoes off `backpack-picker` itself
  (or cherry-picking it in) so the two features compose rather than collide,
  and say so explicitly in the shoes PR description for whoever reviews/merges
  order. Do **not** silently duplicate `buildChoiceSection` or re-invent the
  `Rng`-stream-per-feature convention — both already exist once backpack lands.

## Draft shoe design — SUPERSEDED, shoe wiring is done

Commit `9f4c0f2` did the whole checklist below against the real `shoes.ts`
(`ShoeKind = 'plain' | 'ripika' | 'sandal' | 'sparkle'`, not the guessed
`sneaker`/`sandal`/`sparklyPink`). Kept for the git-archaeology trail only —
skip straight to that commit's message or diff for what actually shipped.

## Draft shoe design (to firm up once `ShoeKind` exists)

Mirrors backpack's shape (kind + colour, chosen once, not a shop item) rather
than hat's shape (catalogue item, bought, swappable mid-game) — per my brief,
and because GAME_DESIGN.md has never mentioned shoes as a shop concept; feet
are currently just `PALETTE.shoe` (`0x7fc4ff`, a fixed blue) painted onto one
hard-coded blob per leg in `kid.ts` (`const foot = blob(0.175, shoeMat, [1,
0.78, 1.28], 18)`, in the `--- legs ---` block, around where `--- backpack
---` follows it a few lines down — so a `buildShoes()` call belongs right
there, replacing the two inline `foot` blobs the same way `buildBackpacks()`
replaced the inline bag block).

**Expected `ShoeKind` union** (per my brief): something like `sneaker`
(today's default shape, ported rather than redrawn — same "a child who's
played before finds her shoes unchanged" principle backpack's `satchel`
followed), `sandal`, `sparklyPink`, plus whatever RiPika-themed kind(s) the
Blender artist actually ships. **Don't guess the exact names — read
`src/art/models/shoes.ts` once it exists and take the union verbatim,** the
same way the backpack integration took `BackpackKind` verbatim from
`backpacks.ts` rather than inventing a parallel list.

**Colour**: per-kind, following the collar/strap precedent — a plain
sneaker/sandal/sparkly shoe likely takes the chosen colour directly on its
upper/sole (a straightforward swatch row: `SHOE_SWATCHES` like
`BACKPACK_SWATCHES`); a RiPika-themed shoe, if it's got a painted-on RiPika
motif (ears, face, etc. — the way the RiPika hat and RiPika backpack both are
literally RiPika's own head), should probably keep RiPika's own palette and
let the chosen colour paint the laces/sole/trim only, exactly like the
backpack's `collar()` helper does for the two creature-head bags. Confirm
against whatever the artist actually built — don't assume every kind takes
full-body colour.

**Integration checklist**, once `src/art/models/shoes.ts` lands with
`ShoeKind`/`SHOE_KINDS`/`CROWD_SHOE_KINDS`/a `buildShoes()`-shaped builder:

1. `state/types.ts`: `SHOE_KINDS` runtime list + `ShoeKind` type,
   `PlayerState.shoeKind` / `.shoeColour`.
2. `state/save.ts`: `SavedPlayer.shoeKind?` / `.shoeColour?`, `readPlayer()`
   entries.
3. `state/store.ts`: `CharacterCreationChoice` fields,
   `completeCharacterCreation()` writes, hydrate overlay, initial-state
   defaults (`shoeKind: 'sneaker'` or whatever the default kind ends up being
   named, `shoeColour: PALETTE.shoe` — reuse the existing constant, it's
   already in `PALETTE` unlike backpack's colour, which had to move there).
4. `state/index.ts`: export `ShoeKind`.
5. `art/models/kid.ts`: `KidOptions.shoeKind?`/`shoeKinds?`, `KidHandle.
   shoeParts`/`setShoeKind()`, replace the two inline `foot` blobs with
   `buildShoes({ body, ...colours, kind: shoeKind, ...(shoeKinds && { kinds:
   shoeKinds }) })` inside the `--- legs ---` loop (or right after it — shoes
   are per-leg, unlike the single backpack, so check whether the artist's
   `buildShoes()` expects to be called once for both feet or once per leg
   pivot; backpack's `buildBackpacks()` is called once and handles both straps
   internally via its own `for (const side of [-1, 1])`, which is probably the
   right shape to match).
6. `ui/CharacterCreation.ts`: `SHOE_OPTIONS`/`SHOE_ORDER`/`SHOES` (Record over
   the whole union, exactly like `BACKPACK_OPTIONS`), a `buildChoiceSection`
   call for `Shoes`, a `buildSwatchSection` call for `Shoe colour`, both
   appended to `controls` and threaded through `refreshPreview()`/`complete()`.
7. `ui/characterCreationPreview.ts`: `PreviewChoice.shoes`/`shoesColour`,
   `PreviewFocus` gains `'shoes'`, `FOCUS_MARGIN` entry, a `boxFor()` branch
   measuring visible `kid.shoeParts` (or just `kid.limbs.leftLeg`/`rightLeg` if
   the artist's parts aren't separately tagged the way backpack's are — check
   what's actually exposed). Almost certainly **no turntable change needed**
   — see point 4 above.
8. `entities/Player.ts`: pass `shoeKind`/`shoeColour` into the real player's
   `createKid(...)` options.
9. `entities/npc/NpcSystem.ts`: new `shoeRng` stream (own salt), roll a
   `CROWD_SHOE_KINDS` member per NPC, pass into `kids.spawn(...)`.
10. `entities/npc/kidCrowd.ts`: `PROTOTYPE_SHOE` constant, prototype built with
    `shoeKind`/`shoeKinds: CROWD_SHOE_KINDS`, `hiddenShoes` map built the same
    way `hiddenBags` is, `spawn()` gains a trailing `shoe` parameter.
11. `scripts/check-asset-contract.mts`: `kid.shoe.${kind}` subjects.
12. `check:assets`, `check:brevity`, `check:text` all clean once any new copy
    (button labels) exists — brevity in particular: keep shoe-kind labels to a
    word or two, matching `{ label: 'Backpack', glyph: '🎒' }`'s brevity.
13. `npm run build` exit 0, checked directly, at every compiling checkpoint —
    commit each one rather than saving it all for one commit, per CLAUDE.md.

## Browser / QA

Did not touch the browser this session — no code built yet, nothing to look
at. Once the shoes feature is built: `gh pr list` first to see who else might
have it; if free, QA per GAME_DESIGN's PREVIEW RULE (each shoe kind
selectable and previewing live, colour swatches behaving like every other
swatch row including the "+" wheel, a phone-portrait layout check since the
creator now has two more sections than the screenshots CLAUDE.md/QA-PLAYBOOK
were tuned against). If not free, build-verify only and list exactly what
needs eyes in the PR, the way PR #131's own description does under "Needs
visual QA".

## Next actions (superseded by the "Status right now" section at the top)

The three steps below were this list's original next actions, from before
shoes existed. All done now — see the top of this file for the current
state and what still needs a pair of eyes on it (browser QA, mainly).

1. ~~Re-check `animal-hat-heads` for shoe commits~~ — done; the real assets
   landed in PR #132, confirmed and wired this session.
2. ~~If still absent: keep waiting~~ — moot.
3. ~~If present: read `src/art/models/shoes.ts` in full, work the checklist~~
   — done, commit "Wire ShoeKind into the character creator…" (see `git log`
   for its current hash — the mohican rebase changed it).

**Actual next actions, this session's end (also superseded, see the top):**

~~1. Whatever the Overseer routes here next.~~
~~2. Keep half an eye on `feat/mohican-hair`; flip `HAT_EXCLUSIVE_HAIR_STYLES`
   once it lands.~~ — done: rebased onto it, activated the exclusivity set.
   Coordinator has not yet run the manual sequence on it — that's the one
   real open item, at the top of "Needs eyes" now.
3. Whenever the shared browser is free: work the "Needs eyes" checklist at
   the top of this file top to bottom. Mohican is untested by anyone; tabs
   and shoes have the coordinator's word but not a phone-width check; the
   Look pill's duplicate-grant wart is unconfirmed-but-probably-harmless.
