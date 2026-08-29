# HANDOFF — check:castle sees the scene (`fix/check-castle-sees-the-scene`)

Branch off `origin/main` @ `62318f05`. Worktree `.claude/worktrees/castle-check-sees`.
No dev server needed — this is a headless check.

## Status: DONE. Both mutations proved red, all gates green, PR raised.

## What was wrong

Every assertion in `scripts/check-castle.mts` called `buildCeilingBeams(deck)` itself
and measured the returned `InstancedMesh`. Nothing asked whether `BuildingShell` ever
added it to a floor group, or whether the deck slab got its flagstone material. The
headline "4 enclosed storeys" was `TOP_DECK` — a constant printed as a finding, which
is why the blindness was invisible.

## What was added — assertion 6

One new section. It constructs a real `BuildingShell('interior')` and counts what it
finds in the tree, per storey:

- `deck-N` slab present, and its material's `map` is identity-equal to
  `castleFlagstoneTexture()` (the texture cache memoises, so identity is a valid test)
- `walls-N` present, `map` identity-equal to `castleCoursingTexture()`
- `castle-timber-plate-N` present, an `InstancedMesh` with `count > 0`, and its
  **world-space** underside equals `deck × BUILDING_FLOOR_HEIGHT + BEAM_UNDERSIDE`
  (so a plate parented to the wrong floor group is a named failure)
- the roof terrace has **no** plate

The check now imports `./headless-canvas.mjs` first, since the shell's materials paint
onto a 2D canvas at construction.

Nothing existing was weakened. Old assertions 1–5 are untouched; old §6 renumbered to 7.

## The summary line

No constant is printed as a measurement any more. `storeysSeen`,
`platedSegmentsInScene`, `flagstonedDecksInScene`, `coursedWallsInScene` are all
incremented only when a mesh was found in the built shell.

## Red proof (the whole point of the ticket)

Mutation 1 — `void beams;` in place of `floor.add(beams)` in `Shell.ts`: **exit 1**,
5 failures, e.g. `scene: storey 0 is an enclosed storey with no ceiling —
'castle-timber-plate-0' was built but never added to the shell`.

Mutation 2 — `interiorMaterial(colour, 0.82)` in place of
`isCastleFloor ? castleFloorMaterial(colour) : ...`: **exit 1**, 5 failures, e.g.
`scene: the deck-0 slab in the built shell carries no flagstone map`.

Both reverted; `git status src/` clean; `check:castle` exit 0.

## Gates

`tsc --noEmit` 0 · `npm run build` (unpiped) 0 · `npm run test:procgen` 0 ·
`check:castle` 0 · `check:park` 0. `check:park-boot` passed inside the build chain.

## Hand-copied constants

Nothing new imported by value. `EXTERIOR_MASONRY_PATTERN` remains a documented,
deliberate duplicate of `parkFacts.ts` (fails safe — false pass here, loud
`test:procgen` failure). `BEAM_WIDTH` in `castleFabric.ts` is still unexported; this
branch does not need it and did not copy it. The `PLATE_BAND = 0.4` copy the Overseer
mentioned is not on `origin/main` — it is in PR #385's version of this file.

## Collision risk

**PR #385 (`feat/castle-interior-376`) also edits `check-castle.mts`.** My diff is one
new section inserted between old §5 and old §6 plus the import block and the summary
line, so a rebase over #385 will conflict at the summary `console.log` and possibly at
the imports. Whoever rebases: keep *both* sets of assertions and make sure the merged
summary line still prints only counted numbers.
