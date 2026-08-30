# HANDOFF — wild pets on the roof garden (issue #406)

Branch `feat/wild-pets-roof-garden`, worktree `.claude/worktrees/wild-pets`.
Dev server port **5406** (`vite --port 5406 --strictPort`), kill by PID.

`pnpm`, not npm. Build chain is **47** steps (parsed from `package.json`; the
brief said 48 — the brief is one out, `vite build` included the count is 47).

## Where the pieces are

- Roof garden: `src/world/building/castleDecor.ts` → `dressRoofGarden(deck, floor)`,
  called from `dressCastle` when `deck >= TOP_DECK`. Roof plate is
  `INTERIOR_HALF_X = 30` × `INTERIOR_HALF_Z = 22` (60 × 44 m).
  Existing content: instanced troughs / shrubs / flower heads round the parapet
  at `inset = 2.3`, `step = 3.2`. Three draw calls total.
- Keep-outs: `keepOutsFor(deck)` in `src/world/building/dressing.ts`. On
  `TOP_DECK` it already excludes the pavilion (r 8), the slide entry (r 5) and
  the grown-up (r 4), plus the stairs, lift lobby and roundel on every deck.
- Pets: `src/art/models/pets.ts` — `createPet(kind)`, `PET_KINDS`,
  `PET_RENDER_HEIGHT = 1.46`, `PUFF_DISPLAY_NAME = 'Trilla'`.
- `src/entities/npc/petBlob.ts` — the third body plan, still used by
  `NpcSystem.ts:760` and re-exported from `entities/npc/index.ts`. Marked for
  deletion in its own docblock.
- The model to copy: `src/world/Flowers.ts`. A living population with an
  `InteractZone` per pickable, a "Pick the flower!" chip, and respawn after a
  pause. Wild pets are the same system with legs.
- Owning: `gameStore.collectFlower(colour)` in `src/state/store.ts` is the
  precedent for "found in the world, free, no shop". Pet catalogue ids are
  `pet.bunny` / `pet.kitten` / `pet.mouse` / `pet.puff` in
  `src/world/building/shops/catalogue.ts`.
- Hook-up point: `Building` is a `GameSystem` — `update(context)` at :845,
  `interactZones()` at :746, decor built at :576.

## Design rulings requested (sent to Overseer, awaiting answer)

1. Keep both pets — recommended.
2. Respawn on a timer, kinds re-rolled — recommended.
3. Failure is delay, never denial — recommended.
4. Puff not catchable; one uncatchable singing Trilla on the roof instead —
   recommended.

Full reasoning is in the report to the Overseer. **Do not build the catch until
these are ruled on.**

## Status

- [x] Read issue, CLAUDE.md, GAME_DESIGN.md pet entries, ART_DIRECTION §7
- [x] Located every file above
- [ ] Long grass
- [ ] Roaming
- [ ] Catch (blocked on rulings)
