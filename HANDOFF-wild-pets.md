# HANDOFF — wild pets on the roof garden (issue #406)

Branch `feat/wild-pets-roof-garden`, worktree `.claude/worktrees/wild-pets`.
Dev server port **5406** (`vite --port 5406 --strictPort`), kill by PID.

## Two environment traps, both paid for

1. ~~**`pnpm` on PATH is the wrong one.** `which pnpm` resolves to an fnm shim
   (v11.5.0) which tries to self-install the pinned 12.1.0 and hands you a
   broken bin: `syntax error near unexpected token ')'` from a shell script
   that is actually an error message. **Use `/opt/homebrew/bin/pnpm`** — it
   spawns 12.1.0 correctly ("Done in 457ms using pnpm v12.1.0").~~

   **CORRECTED, 30 Aug — just type `pnpm`. Do not hard-code the Homebrew
   path; that advice was mine and it is now wrong.**

   The breakage was real but my explanation of the fix was not. Homebrew's
   pnpm is **11.20.0**, not 12.1.0. It ran the pinned commands correctly
   because **pnpm 10+ re-executes itself as the `packageManager` version**
   before doing any work — I saw the switch happen and credited the binary
   for what the pin was doing.

   The genuinely broken one was the fnm pnpm at the front of `PATH`. pnpm 12
   ships as a native binary written over a placeholder by a postinstall step;
   11.5.0 fetched 12.1.0 and never ran that step, leaving a 282-byte prose
   placeholder where the Mach-O belongs — so the shell parses English. Both
   downloads sit in the store side by side, one 33 MB and one a text file.
   The `using pnpm v11.5.0` line I read was 11.5.0 running *as itself* in the
   shared checkout, which is on a stale branch with no `packageManager` field
   at all: no pin, no switch. **The fnm pnpm is now upgraded to 11.24.0 and a
   plain `pnpm` resolves per project.**

   Carry this: **`pnpm --version` cannot tell you which version will run.**
   Check `npm_config_user_agent` from inside the project instead —
   `pnpm exec node -e "console.log(process.env.npm_config_user_agent)"`
   printed `pnpm/12.1.0`, which is how PR A's gates are known to have run
   under 12.1.0 rather than assumed to have.
2. **The build chain is 47 steps, not 48.** Counted by parsing
   `package.json` (`scripts.build.split('&&').length`), as CLAUDE.md's own
   "a check that never runs" section requires. CLAUDE.md also says 47.

## Where every piece lives

- Roof garden: `src/world/building/castleDecor.ts` → `dressRoofGarden`.
  Roof plate 60 × 44 m (`INTERIOR_HALF_X/Z` = 30/22).
- Keep-outs: `keepOutsFor(deck)` in `dressing.ts`.
- **Shafts: `BUILDING_SHAFTS` + `regionContains` in `layout.ts`.** Not in
  `keepOutsFor`. A shaft's structure comes down through *every* storey; the
  helter-skelter shaft is under the roof garden and the first meadow grew
  straight through it. `check:castle` caught it.
- Pets: `src/art/models/pets.ts`. `src/entities/npc/petBlob.ts` is the third
  body plan, marked for deletion, still used by `NpcSystem.ts:760`.
- The pattern to copy for a living population: `src/world/Flowers.ts`.
- Owning: `gameStore.collectFlower` in `store.ts` is the "found, free, not
  from a shop" precedent.
- Hook-up: `Building` is a `GameSystem` — `update()` :845, `interactZones()`
  :746, decor built :576.

## Findings that change the design

### RiPika is already an ownable companion — via the catalogue, not `PetKind`

- The starter "pet" **is `toy.ripika`** — `kind: 'toy'`, `category: 'toy'`,
  `model: () => createRipika()`. `CharacterCreation.ts:273`:
  `PET_OPTIONS = [shopItem('toy.ripika'), ...itemsForShop('stickerPet')…]`.
- So the game's real "thing that walks behind you" abstraction is
  **`ShopItem`/`InventoryItem` keyed by catalogue id**, not `PetKind`.
  `PET_KINDS` is an *art* enum: which bodies `pets.ts` knows how to build.
- **`createRipika()` already returns `height: 1.46` — exactly
  `PET_RENDER_HEIGHT`.** `pets.ts`'s docblock says RiPika is the reference the
  pets were normalised to. So making her a pet costs nothing in size;
  `sizeToStandard` would scale her by 1.0.
- Her head is already shared one-definition via `buildRipikaHead(scale)` —
  the hat, the backpack and the keychain all take it. Unaffected by any of this.

### The `PET_KINDS` consumers, and what a fifth member does to each

| Consumer | Effect of a 5th kind |
| --- | --- |
| `fitouts.ts:411` pet-shop pen | 5 pets on a circle sized for 4. `check:shop-spacing` is in the chain — **must be run** |
| `Hotel.ts:4363` | `PET_KINDS.forEach` placing pets — needs enough spots |
| `Hotel.ts:5254` | parses `pet.<species>` id tails against `PET_KINDS`. **RiPika's id is `toy.ripika`, so this would not find her** |
| `gondola.ts:910` | `PET_KINDS[i % len]` for 3 ferris-wheel tub chairs — safe, but changes which pets ride |
| `check-asset-contract.mts:241` | asserts `pet.${kind}` for every kind — a new `pet.ripika` key gets measured |
| `petBedFit.ts` | measures every companion to size hotel pet beds; RiPika has limbs and a tail, so a wider footprint |

**The crux is the catalogue id.** `toy.ripika` → `pet.ripika` is a
save-breaking change: `state/save.ts` stores inventory by id and the
Cute-o-dex is keyed by it. Every existing save's starter pet would vanish.
That decision deserves its own PR and its own review.

## Scope decision: split into two PRs

**PR A — RiPika becomes a pet** (the refactor, on its own).
**PR B — wild pets on the roof** (grass, burrows, roaming, catching), on top.

Cleanly separable *in that order*: B wants to iterate the catchable kinds, and
if A has landed that is just `PET_KINDS`. A does not need B at all. Splitting
also keeps a save-format decision out from under a feature diff, and three
other branches (#401/#403/#405) are live in this area.

## Numbers chosen for the chase (report to Overseer, not yet built)

`PLAYER_MAX_SPEED` is **7.4 m/s** (sprint ×1.5 = 11.1).

- Creature burst **6.5 m/s** (0.88 × player walk) — "quite quickly", but she
  always closes even without sprinting.
- Cruise **3.0 m/s**, with pauses. Average ≈ 3.5 m/s, under half her walk.
  Non-constant speed is what makes it read alive *and* winnable.
- Destination choice: **80 %** away from the player, 20 % free — at
  destination-choice time, per Jim.
- Catch radius **2.2 m**, off tap-to-walk arrival, so imprecise tapping wins.

## Burrow lifecycle (chosen shape, to be confirmed)

- 5 burrows in the meadow, ≥ 6 m apart. Max 4 creatures out at once.
- A creature must be out **35–60 s** before it may dive at all.
- **It never begins a dive while the player is within 9 m.** This is the one
  that makes "no failure state" literally true from her point of view: while
  she is chasing, it cannot leave. Closing distance is always progress.
- The dive is telegraphed — walk to burrow, then **1.2 s** of wiggle-and-look.
  Coming inside 9 m during the wiggle aborts it and it bolts again.
- Next emergence **3–6 s** later, so the next attempt is seconds away.

## Announcement

Jim's exact wording: **"a wild x appears!"** — his casing, his `!`. Name comes
from the one existing source (`PetHandle.displayName` /
`PUFF_DISPLAY_NAME = 'Trilla'`), never a second table. Must obey
GAME_DESIGN's TEXT/UI-SCALE rule. Several at once: **one line that replaces
the last**, so a child never has three to read.

## Status

- [x] Research: issue, CLAUDE.md, GAME_DESIGN #21/#30h, ART_DIRECTION §7
- [x] **Long grass — built, committed, pushed** (`roofMeadow.ts`)
      `tsc` 0, `check:castle` 0
- [ ] Roaming
- [ ] Burrows + catching + announcement
- [ ] RiPika refactor (recommend separate PR)
- [ ] Delete `petBlob.ts`, point `NpcSystem` at `createPet`
