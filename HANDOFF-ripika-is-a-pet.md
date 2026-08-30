# HANDOFF — RiPika is a pet (PR #409, groundwork for #406)

Branch `feat/ripika-is-a-pet`, worktree `.claude/worktrees/ripika-pet`.
Rebased onto `5ba4a28b` (#401). **PR #409 open, CI running.**

This is PR **A** of a two-part split. PR **B** is the wild pets themselves,
on `feat/wild-pets-roof-garden` (see `HANDOFF-wild-pets.md` there) and it
stacks on top of this.

## Environment

Just type `pnpm` — it resolves per project and runs the pinned 12.1.0.
**`pnpm --version` cannot tell you which version will run**; check
`pnpm exec node -e "console.log(process.env.npm_config_user_agent)"`.
Earlier advice in `HANDOFF-wild-pets.md` to hard-code `/opt/homebrew/bin/pnpm`
is struck there — do not follow it.

Build chain is **47** steps; `test:procgen` is not in it and must be run
separately.

## What this PR does

1. `PetKind` gains `'ripika'`; `createPet('ripika')` delegates to
   `createRipika()`. One body, one colourway, one set of proportions.
2. Catalogue id `toy.ripika` → `pet.ripika`, `kind`/`category` → `'pet'`.
   `shopId` stays `'toy'` — she is a pet still bought at the toy shop.
3. `petKindsForShop(shopId)` in `catalogue.ts` — the pet-shop pen stocks what
   the shop *sells*, not what `pets.ts` can *build*. Pen unchanged at 4.
4. Hotel corridor statue row spacing fitted for any N.
5. `check:assets` proves every pet is the same height as every other pet.

## The thing a reviewer must not miss

**Existing saves get a ghost RiPika, not a clean loss.** Measured:

- `save.ts readInventoryItem()` does **not** validate ids against the
  catalogue — it rebuilds from the save file, so `toy.ripika` survives.
- `Parade.ts:440` `if (!catalogue) continue` — so she is silently skipped.
- A returning save never re-runs character creation, so no replacement.

She keeps a RiPika in her Cute-o-dex that can never appear. Jim ruled "no
migration"; this outcome is stated at the top of the PR body so the ruling is
made against what actually happens. **If it is reversed, the fix is one entry
in `save.ts`'s existing `MIGRATIONS` table.**

## Findings worth carrying

- **`keepOutsFor` does not include the shafts.** A shaft's structure comes
  down through every storey; `keepOutsFor` lists only the helter-skelter's
  *entry*, on its boarding deck. Third occurrence in two days (great-hall
  feast table, #401's bubble, my roof meadow). Callers each work around it by
  also testing `BUILDING_SHAFTS`. Fold it in at the source.
- **`PET_RENDER_HEIGHT = 1.46` is a stale hand-copy.** RiPika builds
  **1.4707** and sits **13.5 mm below her own origin**; the other four land on
  1.4600 exactly. Both inside existing tolerances. Recorded in the tolerance
  comment in `check-asset-contract.mts`, deliberately not fixed here.
- **`check:park-boot` flaked once** (21.2 ms vs an 8 ms budget), then 3/3
  green. Known #324, not caused by this diff.

## Mutation transcript for the new check

Proved against **this branch's** geometry (a transcript is a measurement and
goes stale — re-prove if the pets change):

1. `sizeToStandard` scale × 1.45 → `pet.bunny: builds 2.117 m against
   PET_RENDER_HEIGHT 1.460 m`. Old check fires too.
2. `createPet('ripika')` wrapped to 0.6 scale **with `height` scaled to
   match** → `1 problem(s) across 102 assets`, and it is this check alone.
   **This is the mutation that proves the added coverage.**

## Status

- [x] Core change, consumers, rename, docs, new check
- [x] tsc 0, tsc:test 0, build 0 (47 steps), test:procgen 0 (458 tests)
- [x] PR #409 open
- [ ] CI green on head commit
- [ ] Review + QA
- [ ] Jim's call on the ghost-save outcome
