# HANDOFF: outfit-two-tone

Branch `feat/outfit-two-tone`, worktree `.claude/worktrees/outfit-two-tone`.

## Status: done, build green, PR not yet opened

Commit `f5d166e` has the whole feature. `npm run build` exits 0 (tsc +
every check script + vite build all pass). Not yet raised as a PR — do that
next if you're picking this up.

## What was built

A new two-tone outfit swatch — red body, white arms — alongside the six
existing single-colour ones.

- `src/art/models/kid.ts`: arms were already a separate mesh
  (`arm-upper-l`/`arm-upper-r`) from the torso, just sharing `outfitMat`.
  Gave them their own `outfitArmsMat`, driven by `KidOptions.outfitArms`
  (defaults to `outfit`, so every existing caller is untouched) and
  `KidHandle.setOutfitColour(colour, armsColour?)` (armsColour defaults to
  `colour`).
- `src/entities/CharacterModel.ts` / `src/entities/Player.ts`: threaded
  `outfitArms`/`outfitArmsColour` through so the *running park* character
  wears it, not just the creator preview.
- `src/ui/CharacterCreation.ts`: `Swatch.armsColour?` (optional, only the new
  preset sets it), a new `OUTFIT_SWATCHES` entry `{ colour: ART.jumperRed,
  armsColour: ART.cream, label: 'Red & White' }`, `buildSwatchSection`'s
  `onPick` now takes `(colour, armsColour)` — every other call site's
  single-param lambda still type-checks (JS/TS allow a narrower callback).
  New `outfitArmsColour` field, threaded into `refreshPreview`/`complete()`.
- `src/style.css`: `.charcreate-swatch--two-tone` — a diagonal
  `linear-gradient` split between `--swatch-colour` and the new
  `--swatch-arms-colour` custom property, added right after the plain
  `.charcreate-swatch` rule so cascade order (not extra specificity) is what
  lets it win.
- `src/ui/characterCreationPreview.ts`: `PreviewChoice.outfitArms` (required,
  same treatment as `outfit`) — this is what made the compiler catch every
  other place that builds a `PreviewChoice`/`FacePaintLook`, which is how
  `src/world/FacePaintStall.ts`'s `playerLook()` got the same field.
- State (`src/state/types.ts`, `store.ts`, `save.ts`):
  `PlayerState.outfitArmsColour` (always resolved, never optional),
  `CharacterCreationChoice.outfitArmsColour`, `SavedPlayer.outfitArmsColour?`.
  **Old-save safety**: `hydrate()` doesn't just default a missing
  `outfitArmsColour` to the initial-state constant — it falls back to
  whatever `outfitColour` *that save* just resolved to
  (`next.player.outfitArmsColour = p.outfitArmsColour ?? next.player.outfitColour`),
  so a save with a Mint jumper keeps Mint arms rather than picking up a
  brand-new character's default pink. This was the one bit worth getting
  right per the brief — a naive `?? PALETTE.outfit` default would have been
  wrong for anyone who'd picked a non-default colour before this field
  existed.

## Colour choice

Used `ART.jumperRed` (0xef5a52, Biscuit's own jumper colour) for the body and
`ART.cream` (0xfff3e2, the game's general warm off-white — tummies, paw pads)
for the arms, rather than adding new hex values. `PALETTE.flowerRed` was the
obvious first candidate but it's already the outfit tab's "Coral" swatch, and
reads as coral/salmon rather than a true shirt red — `jumperRed` is closer to
what a six-year-old would call red, and literally already named for a garment.

## What's NOT done / known gaps

- **No live browser verification.** Tried to reach the Overseer ("main") to
  ask for chrome-devtools ownership before doing this; see whatever the
  SendMessage thread says. If nobody answered in time, this shipped on
  build-verification only — flag this explicitly in the PR body.
- `src/minigames/dodgems/Dodgems.ts`'s "You" driver (the player's kid, built
  as a simplified NPC stand-in for the dodgems minigame) does **not** carry
  `outfitArms` — its `DriverKind` union only has `hair`/`outfit`/`hairStyle`
  fields today, and it's already an approximation (fixed `hairStyle:
  'bunches'` regardless of the player's real style, no skin tone, no shoes).
  Left alone deliberately: extending `DriverKind` for full fidelity is a
  separate, larger change than this feature asked for, and the existing
  approximation already drops more than just this.
- `npm run test:procgen` could not be run in this environment —
  `node_modules/vitest` is not installed in the shared checkout's
  `node_modules` at all (only `vite` is present in `.bin`, despite `vitest`
  being a real `devDependency` in `package.json`/`package-lock.json`). This
  looks like a pre-existing environment gap, not something this change
  caused — `test/procgen/invariants.ts` is untouched, and nothing in this PR
  touches procgen. Worth flagging to Jim/the Overseer if it keeps happening
  to other agents too.

## Next step if you're picking this up

1. If you now have chrome-devtools ownership, spin up a dev server on your
   own port, open the character creator, and check: the new "Red & White"
   swatch renders as a split circle, picking it shows red torso / white arms
   in the live preview, and every existing swatch still shows arms matching
   body (this was explicitly required — check at least one, e.g. Mint).
2. `gh pr create` — don't merge it yourself.
