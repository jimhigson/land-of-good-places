# Handoff — character-creation owner

**Branch** `charcreate-owner`. **Worktree** `.claude/worktrees/charcreate-owner`.
**Role**: persistent owner of `src/ui/CharacterCreation.ts` and everything it
wires together. This role continues across sessions — Overseer routes future
character-creation work here.

## Status right now

Pure orientation + design-note checkpoint. **No game code changed yet.** The
shoe assets (`ShoeKind`, builder functions) are not ready — see below — so per
my brief I spent this session studying the codebase and preparing the design
note that follows, so I can move fast the moment they land.

`npm run build`: not run this session (no code touched). Will run and report
exit code the moment I start writing code.

## Shoe assets: not landed yet

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

## Next actions

1. Re-check `animal-hat-heads` for shoe commits (fetch + log) at the start of
   the next session before anything else.
2. If still absent: keep waiting, or ask the Overseer for a status check on
   the Blender agent — don't start guessing at `ShoeKind` values and building
   against a fiction.
3. If present: read `src/art/models/shoes.ts` in full first, reconcile it
   against the "expected" section above (it will differ — that's fine, the
   real file wins), then work the checklist top to bottom, committing after
   each file group compiles.
