# Handoff: Glasses tab for character creation

Branch `feat/glasses-ui`, based on `origin/main` with `feat/glasses-assets`
merged in (fast-forward, no conflicts — that branch only touched art/model
files and a new script). Three commits on top of the assets:

- `Add glassesKind to player state, with save/load support`
- `Wear the character's chosen glasses in the running game`
- `Add a Glasses tab to character creation`

## Status: done, build green, PR not yet opened when this was last written —
check `gh pr list` / `gh pr view` before assuming it still needs opening.

## What this adds

A **Glasses tab** in the character creator, between Eyes and Outfit. Four
choices: None (default), Sunglasses 🕶️, Star ⭐, Heart 💖. Wired through:

- **State**: `PlayerState.glassesKind: GlassesKind | null` (`state/types.ts`),
  threaded through `CharacterCreationChoice`, `completeCharacterCreation`,
  `createInitialState`, `hydrate`, and save/load (`state/save.ts`, `null` is a
  real answer the same way `facePaint` treats it — see `readNullableMember`).
- **Live 3D preview** (`ui/characterCreationPreview.ts`): `PreviewChoice.glasses`,
  attached to `kid.glassesAnchor` via `createGlasses(kind)` the same way the
  hat attaches to `hatAnchor` — no hiding/exclusivity logic, per the asset
  agent's confirmation that hats and glasses coexist cleanly.
- **The running game** (`entities/CharacterModel.ts` + `entities/Player.ts`):
  `CharacterModel.glassesAnchor` forwards `KidHandle.glassesAnchor`; `Player`'s
  constructor attaches `createGlasses(playerState.glassesKind)` once, at
  spawn. **Static, not reactive** — unlike hats there is no `WornGlasses`
  system, because glasses are never sold and nothing changes them mid-game.
  If that ever changes (a glasses stall, say), model this on `WornHat.ts`.
- **Face-painting stall** (`world/FacePaintStall.ts`): `playerLook()` now also
  passes `state.player.glassesKind` through, so that preview kid wears them
  too — `FacePaintLook` derives from `PreviewChoice` via `Omit`, so this was a
  compile error until fixed, not a design choice I could skip.

## Design decisions worth knowing about

- **`focus: 'face'`, reused from the Eyes tab** — no new `PreviewFocus` value.
  Glasses sit at eye height, right next to what that framing already shows.
  Note: in the *character creator's own preview kid* (built without
  `facePatch: true`), `boxFor('face')` actually returns `null` because there
  is no mesh named `'facePatch'` on that kid (the default kid bakes the face
  into the skull texture; only the NPC crowd's prototype uses a separate
  patch mesh) — so today the 'face' focus silently falls back to `boxFor('all')`
  for *every* tab that uses it, Eyes included. This is pre-existing behaviour,
  not something I introduced or fixed; flagging it here in case a future pass
  through this preview wants to fix 'face' framing properly.
- **`GlassesChoiceValue = GlassesKind | 'none'`** is a UI-local type in
  `CharacterCreation.ts`, not something asked of `state/` or `art/` — "none"
  is a genuine 4th button, but `PlayerState.glassesKind` represents it as
  `null` rather than a 4th enum member (mirrors how `facePaint` already does
  this). Converted at the two boundaries (`refreshPreview`, `complete()`).
- Glyphs: 🕶️ sunglasses (also the tab's own glyph, same precedent as Hair/💇),
  ⭐ star and 💖 heart both reused from existing catalogue icons
  (`toy.star`/`egg.prize.star` use ⭐, `sticker.hearts` uses 💖) rather than
  invented fresh. 🙈 for "None" — no existing "no choice" glyph precedent in
  this file to reuse (hair/shoes/backpack have no bare/none option), so this
  is a judgement call, not a house convention.

## Verification

- `npm run build` — exit 0 (ran and checked properly, not piped through
  tail/head). Includes `check:assets`/`check:glasses-fit` etc., all pass.
- `npm run test:procgen` — 45/45 tests green. Not expected to be affected
  (nothing here touches procedural generation) but ran it anyway per CLAUDE.md.
  Note: vitest was not present in the shared checkout's `node_modules`; had to
  run `npm install` inside this worktree to get it (fast, used local cache).
- **No live browser verification.** Did not have chrome-devtools ownership —
  messaged the Overseer ("main") once the PR-worthy state was reached, offering
  to do a visual pass if granted ownership, but did not block on a reply.
  Whoever reviews/QAs this should specifically check: the Glasses tab's four
  tiles render and select correctly, the live preview actually swaps the worn
  glasses (including "None" removing them), and a freshly-created character
  spawns into the park wearing the chosen pair.

## If you're picking this up cold

Check `git log --oneline` on this branch first — the three commits above are
self-contained and each compiles on its own. If a PR already exists
(`gh pr list --head feat/glasses-ui`), don't open a second one.
