# Handoff — charcreate-fixes

**Branch** `fix/charcreate-reset-and-no-hat`. **Worktree**
`.claude/worktrees/charcreate-fixes`. One file touched:
`src/ui/CharacterCreation.ts`.

## Status: both fixes implemented, `npm run build` exit 0, PR not yet raised

### Issue 1 — reopening the creator reset every field to a hardcoded default

Root cause, confirmed by reading the code path end to end (not assumed): the
class's private fields (`skinColour`, `hairColour`, `hairStyle`, `outfitColour`,
`outfitArmsColour`, `eyeColour`, `backpackKind`, `backpackColour`, `shoeKind`,
`shoeColour`, `glassesKind`, `hatId`) all had **literal field initializers**
(`= ART.kidSkin`, `= PALETTE.hair`, `= 'bunches'`, etc.) — the constructor
never looked at `gameStore` at all. `main.ts`'s `reopenCharacterCreation`
(what the HUD's "Look" pill triggers, via a page reload) already does
`gameStore.hydrate(save)` *before* constructing `CharacterCreation`, so the
correct data was sitting in the store the whole time; the screen just never
read it. This was a known, documented limitation — see the old comment on
`applyHairStyle` and `HANDOFF-charcreate-owner.md`'s "Look pill" section —
not a regression from an unrelated change.

Fix: added a module-level `currentAppearance()` helper that returns
`gameStore.get().player` (+ the worn hat's catalogue id, resolved from
`wornHatUid` via the inventory) whenever `saveFlags.createdCharacter` is
true, or `null` on a genuinely fresh profile. The constructor now seeds every
field from this (`current?.player.x ?? <same literal default as before>`),
so:
- **Fresh profile** (`startFresh`, no save yet): `current` is `null`, every
  field falls back to exactly its old hardcoded default — verified the
  defaults in `createInitialState()` (`state/store.ts`) numerically equal
  this screen's old literals (`PALETTE.skin === ART.kidSkin`,
  `PALETTE.iris === ART.kidEye`, etc.), so this path is unchanged.
- **Reopened over an existing character**: every field now starts from her
  actual current look instead of resetting.

The hat needed one extra layer of care: `hatId: null` already meant
"bare-headed", but only ever reachable *transiently* while an exclusive hair
style (Mohican) was picked (`HAT_EXCLUSIVE_HAIR_STYLES`). Seeding from a
saved character who is mid-Mohican (or who deliberately went bare-headed —
see Issue 2) needed the constructor to apply the exact same
exclusivity/hide-the-hat-tab logic `applyHairStyle` applies on a live pick,
just up front — done, including hiding `hatTabButton` at build time rather
than showing-then-hiding it.

Pet was deliberately **not** seeded from "current" — there is no
`wornPetUid`/equivalent single-slot field for it anywhere in `GameState`; a
pet is a one-time free grant into the parade
(`completeCharacterCreation`'s `grantFree`), not something with a "currently
equipped" answer the way a hat has. Left as the suggested default, same as
before. This seemed the correct reading of the task ("whatever's
customisable") rather than inventing a new store field, but flagging it in
case Jim wants a different answer.

### Issue 2 — explicit "No hat" option

Added a `noneOption` parameter to `buildCardSection` (used by both the Hat
and Pet tabs) — additive and optional, so the Pet tab's call site is
untouched. The Hat tab's `buildHatSection` now passes a "No hat" 🙅 card,
placed first (same "safe answer first" convention `GLASSES_ORDER` already
uses). Picking it sets `hatId = null` directly — no new state machinery
needed, since `null` was already a fully-supported "bare-headed" value all
the way down: `complete()` → `CharacterCreationChoice.hat = null` →
`completeCharacterCreation` → `setWornHat(null)` → `entities/WornHat.ts`
already renders nothing for a null `wornHatUid`. Verified this rendering
path already existed (used by the backpack-drawer "take hat off" flow)
rather than assuming it.

One knock-on fix this required: `hatIdBeforeExclusiveHair` used to be
`string | null`, with `null` doing double duty as "nothing is stashed" *and*
(after this change) "what's stashed is genuinely 'no hat'". `applyHairStyle`
used `?? DEFAULT_HAT_ID` to restore it, which would have silently replaced a
deliberately-bare-headed look with the party hat the moment she left an
exclusive hair style. Fixed by widening the type to
`string | null | undefined`, with `undefined` now meaning "nothing stashed"
and `null` meaning "stashed value was itself no-hat", and switching the
restore line to `!== undefined ? … : DEFAULT_HAT_ID`. Traced by hand: (a)
normal hat → Mohican → back — unchanged, restores the hat; (b) bare-headed
(via the new "No hat" card) → Mohican → back — now correctly stays
bare-headed instead of regressing to the party hat; (c) reopen already on
Mohican — same as before, nothing to restore.

## Build / verification

- `npm run build` — exit 0, run directly (not piped). Includes `tsc --noEmit`
  and every `check:*` script; all passed.
- `npm run test:procgen` — not applicable, no procgen files touched (only
  `src/ui/CharacterCreation.ts`). Attempted anyway for due diligence; failed
  with `vitest: command not found` — `vitest` is absent from
  `node_modules/.bin` in this checkout even though it's listed in
  `package.json`'s `devDependencies` (checked the shared checkout too, same
  gap). Pre-existing environment issue, unrelated to this branch — did not
  touch it.
- **Not done**: no browser/chrome-devtools QA. Per `CLAUDE.md`'s "The
  browser" section, agents don't get MCP browser access without being told
  they own it, and I was not told that here. Both fixes are logically
  sound and traced by hand end-to-end, but need an actual click-through,
  especially Issue 1 ("does it really continue from where I left off" is
  the whole point and is best confirmed by looking at it) and the Mohican +
  "No hat" interaction in Issue 2.

## Suggested manual QA checklist for whoever has the browser

1. Play a bit, customise everything (hair, outfit colours, glasses, shoes,
   backpack, a non-default hat), open the HUD menu, press "Look". Confirm
   every tab already shows what she's currently wearing, not the defaults.
2. In the Hat tab, pick "No hat", confirm the preview shows bare-headed,
   press "Let's go!", confirm she's genuinely bare-headed in the running
   game (not just visually — check the backpack drawer doesn't think a hat
   is worn either).
3. Reopen "Look" again after step 2 — confirm "No hat" is what's shown
   selected, not the party hat.
4. Pick Rooster (Mohican) hair with a hat on; confirm the Hat tab
   disappears and the hat comes off. Switch to a different hair style;
   confirm the hat comes back. Then repeat with "No hat" selected before
   switching to Mohican — confirm switching away restores bare-headed, not
   the party hat (this is the specific regression the `undefined`/`null`
   fix above targets).
5. Phone-width pass on the Hat tab grid — one more row card than before,
   confirm it doesn't break the grid's wrap.
