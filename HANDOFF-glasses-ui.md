# Handoff: Glasses tab for character creation

Branch `feat/glasses-ui`, based on `origin/main` with `feat/glasses-assets`
merged in (fast-forward, no conflicts — that branch only touched art/model
files and a new script). Commits on top of the assets:

- `Add glassesKind to player state, with save/load support`
- `Wear the character's chosen glasses in the running game`
- `Add a Glasses tab to character creation`
- `Handoff: Glasses tab done, build green, no browser QA yet`
- `CharacterCreation: dedupe the glasses 'none'->null conversion`

## Status: PR #141 open (https://github.com/jimhigson/land-of-good-places/pull/141),
build green, code + self-review + live browser QA all done and posted as a PR
comment. Ready for peer review — not merged (that's the Overseer's call, and
never self-merge per CLAUDE.md). Check `gh pr view 141` for the current state
before assuming anything here is stale.

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

## Self-review pass (simplify skill, 4 parallel agents)

Ran reuse/simplification/efficiency/altitude review against just this branch's
own diff (`git diff 22ef928...feat/glasses-ui`, i.e. excluding the merged-in
asset commits). Findings:

- **Fixed**: `refreshPreview()` and `complete()` both repeated
  `this.glassesKind === 'none' ? null : this.glassesKind`. Pulled into a
  private `glasses` getter, read at both sites (see the dedupe commit).
- **Reuse/efficiency**: nothing else found — the diff was judged to correctly
  reuse every established pattern it was modelled on (`ShoeKind`'s union
  shape, `readUid`'s "null is a real answer" precedent, `buildChoiceSection`,
  the hat's attach-to-anchor idiom), with no new per-frame or startup cost.
- **Altitude finding, deliberately skipped**: one reviewer argued the glasses
  attach should live *inside* `createKid`'s `KidOptions` (like
  `hairStyle`/`backpackKind`/`shoeKind`) rather than as an externally-attached
  anchor (like the hat), to avoid the attach logic being duplicated between
  `Player.ts` and `characterCreationPreview.ts`. Deliberately not applied:
  hairStyle/backpackKind/shoeKind live inside `createKid` specifically because
  the **NPC crowd** needs one prototype kid carrying several built variants at
  once (`hairStyles`/`backpackKinds`/`shoeKinds` options, `hairParts`/
  `backpackParts`/`shoeParts`, `setHairStyle`/`setBackpackKind`/`setShoeKind`)
  — glasses has no such requirement (no NPC ever wears glasses), so it is
  architecturally much closer to the **hat**, which uses exactly this
  "external attach to a named anchor" pattern for the identical reason (a
  `ShopItem`-driven asset with no crowd multi-variant need), and which already
  duplicates its own attach call between `Player`/`WornHat.ts` and the
  preview. Following the hat's precedent here is the smaller, more consistent
  choice, not a shortcut — and the change the reviewer wanted also reaches
  into `art/models/kid.ts`, which belongs to the already-merged
  `feat/glasses-assets` branch, not this diff.

## Verification

- `npm run build` — exit 0 (ran and checked properly, not piped through
  tail/head). Includes `check:assets`/`check:glasses-fit` etc., all pass.
- `npm run test:procgen` — 45/45 tests green. Not expected to be affected
  (nothing here touches procedural generation) but ran it anyway per CLAUDE.md.
  Note: vitest was not present in the shared checkout's `node_modules`; had to
  run `npm install` inside this worktree to get it (fast, used local cache).
- **Live browser verification — done.** Rail-race QA and merge finished, the
  Overseer freed up chrome-devtools and I ran the pass: own dev server on
  port 5263 (`--strictPort`), background page, killed the server by PID and
  closed the page when done. Confirmed: all four Glasses tiles select
  correctly (rainbow HIGHLIGHT ring, `aria-pressed`), the live preview swaps
  Sunglasses/Star/Heart distinctly and **None** genuinely removes the mesh
  (not just deselects), and a freshly spawned `Player` in the park wears the
  chosen glasses (screenshotted Star glasses on "Eleri" after "Let's go!").
  No console errors/warnings anywhere in the session. Findings posted as a PR
  comment. One non-issue noted there: at a narrow/short viewport (700×700)
  the tab content needs `.charcreate-controls` scrolled into view — this
  reproduces identically on the pre-existing **Skin** tab, so it is the
  documented 28 July 2026 phone-layout behaviour working as designed, not a
  regression from this PR.

## If you're picking this up cold

Check `git log --oneline` on this branch first — the three commits above are
self-contained and each compiles on its own. If a PR already exists
(`gh pr list --head feat/glasses-ui`), don't open a second one.
