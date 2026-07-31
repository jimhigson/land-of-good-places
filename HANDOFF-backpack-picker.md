# HANDOFF — backpack picker (shape + colour), NPCs too

Branch `backpack-picker`, worktree `.claude/worktrees/backpack-picker`.

## What I found (the state before this branch)

- **There is already a backpack**, but it is *hard-coded geometry inside
  `createKid`** (`src/art/models/kid.ts`, the `--- backpack ---` block): one
  rounded box named `backpack`, a darker flap, two straps. `KidOptions` has
  `backpack?: boolean` and `backpackColour?: number` — so **colour was already
  parameterised, shape was not at all**.
- `backpackAnchor` (ART_DIRECTION §7) is a bare `Group` at `(0, 0.74, -0.3)` on
  `body`. `entities/parade/BackpackPeek.ts` mounts peeking creatures on it. It
  must keep working for every new shape → each shape declares its own mouth.
- **NPC bag colour is already randomised**: `NpcSystem.pickColours` rolls
  `bag: rng.pick(BAG_COLOURS)`, and `kidCrowd.ts` repaints it per child through
  the `SENTINEL_BAG` / `bag` / `bagDark` colour roles. Only the *shape* was missing.
- `keychain-shop` branch: not present on origin; nothing attaches a charm to the
  bag today.
- Template to copy for shapes: `art/models/hair.ts` (`HairPart { mesh, styles }`
  + lazy `add()` + `setStyle`) and how `kidCrowd.ts` inverts that into
  "wearing this, hide these part indices".

## Design decisions

- New `src/art/models/backpacks.ts`, mirroring `hair.ts` exactly:
  `BackpackKind` = `satchel | bubble | heart | ripikaHead | trillaHead`,
  `buildBackpacks({ body, kind, kinds? })` → `{ parts, anchor, setKind }`.
  Parts are built **lazily**, so the creator's preview (which rebuilds the whole
  kid on every tap) never pays for four unchosen shapes.
- `ripikaHead` / `trillaHead` reuse `buildRipikaHead` and `createPuffCreature`
  wholesale — no new geometry — exactly as `hats.ts` does.
- **Colour**: the sewn shapes take it on the bag body (bag / bag×0.82 shades,
  same two materials the crowd's sentinels already know). The two creature heads
  keep their own character colours (RiPika is yellow, or she is not RiPika) and
  the chosen colour paints the straps and the collar they sit in.
- **`CROWD_BACKPACK_KINDS` excludes the creature heads** — same shape of
  decision as `CROWD_HAIR_STYLES` excluding `longPonytail`, and for the same
  reason: ~20 more instanced draw calls for a 0.3 m prop on a background child,
  plus each head carries a `facePatch` and `kidCrowd`'s `findFaceMesh` assumes
  exactly one per model.
- The creature-head bags' face patches are renamed `backpack.facePatch` so
  `getObjectByName('facePatch')` (the preview's `face` framing) still finds the
  child's own face.

## Status

- [x] `backpacks.ts` + `kid.ts` rewire, `check:hair` / `check:assets` extended
- [x] state (`types`/`store`/`save`) + `Player`
- [x] preview (`backpack` focus turns the plinth) + `CharacterCreation` sections
- [x] NPC shape roll (own `Rng` stream, so no existing roll shifts)
- [x] whatsnew + docs, full `npm run build` green
