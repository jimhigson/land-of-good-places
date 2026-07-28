# HANDOFF — signs-2d

**Branch:** `signs-2d` off `origin/main` (55b9b4f, includes PR #100 SELECTION RULE).
**Worktree:** `.claude/worktrees/signs-2d`.

## The ruling

Family, 28 July 2026: *3D signs are hard to read. Remove them from the world
entirely; instead, when an item is selected, its sign appears in 2D
screen-space above the action chips.*

## Design decided

1. `InteractZone.sign?: ZoneSign` — `{ title, note?, glyph?, accent? }` in
   `src/world/interact.ts`. Copy is plumbed from the tables that already hold
   it (stall definitions, shop skins, station seeds), never retyped.
2. The card lives **inside** `.action-chips` as a sibling of the chip row, so
   the browser lays the two out together and one transform positions both —
   they can never overlap and they clamp as one block. `.action-chips` becomes
   a flex **column** (card, then `.action-chip-row`); `column-reverse` flips
   the card below the row when there is no room above.
3. Everything that painted text into the 3D world goes: `world/signs.ts`,
   `ui/SignReader.ts`, `cuteSign()` in `building/parts.ts`, `signTexture()` in
   `core/textures.ts`, and every board that used them.

## Findings worth keeping

- **All five anchor placeholders are already hidden** (Building hides
  `building`+`ballPit`, AnchorPlots hides `ferrisWheel`, the dodgems and
  water-fight plots hide their own). So `buildPlaceholder`'s sign was dead
  scenery — but its `collision.addCircle(ex, ez, 0.5)` was **not**: an
  invisible post on the very spot each path spur arrives at. Removing it is a
  real fix, and it is the thing `check-park.mts`'s comment at ~line 407
  describes ("five of the anchors ... the sign post standing on the very spot
  the spur arrives at").
- A zone with **no actions is not selectable** (`Selection.selectable`), so a
  sign-only zone cannot exist. The card is therefore strictly an adornment on
  zones that already offer something. Consequence: the front door, trampoline,
  bubble and slides get no card. The castle's "The Castle / come in and look
  around!" copy has no home — accepted, it is obviously a castle.
- The park name is already shown by the HUD pill (`Hud.ts:290`), so removing
  the entrance arch's park-name board does not lose it from the game.
- `check:brevity` walks `ANCHORS.signTitle/signSubtitle`. Those fields die with
  the boards, so the script must be repointed at the copy that is now live.

## Status — DONE, PR raised

- [x] Study main, design settled
- [x] Zone sign payload + card
- [x] Removals (every `signTexture`/`cuteSign`/`markAsSign` site)
- [x] Checkers: `check:park` ratchet tightened, `check:brevity` left alone —
      see below
- [x] `npm run build` exit 0

**`check:brevity` needed no change after all.** `ui/ParkMap.ts:653` draws each
map pin from `anchor.signTitle`, so the anchor copy in `anchors.ts` is still
live and the check still measures something real. Nothing was silenced.

**`check:park` ratchet tightened, and it loosened because the park got
better**: removing the invisible sign-post colliders took `anchor.reach:ballPit`
to zero (entry deleted), `anchor.reach:building` from 2.0 m to 0,
`anchor.reach:dodgems` 1.8 → 1.7, `rail.exclusion` 14 → 12, `rail.walkable`
34 → 31.

## Follow-ups left for another PR

- The **E-routing bug** reported mid-task was NOT touched — out of scope here
  and not started.
- `whatsnew.json` has no entry for this change.
- The castle, ball pit, helter-skelter and ginormous slide have no sign card,
  because they have no actions and so are not selectable. Accepted, not
  overlooked — see the finding above.

**Browser:** not owned by this task. Build-verify only; visual QA listed in the PR.
**Conflict watch:** PR #101 (race coaster) may touch `Game.ts`.
