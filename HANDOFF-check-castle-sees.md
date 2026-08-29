# HANDOFF — check:castle sees the scene (`fix/check-castle-sees-the-scene`)

**Rebased onto `origin/main` @ `1b8b436d`** (PR #385 merged). Worktree
`.claude/worktrees/castle-check-sees`. No dev server needed — this is a headless check.

## Status: DONE, rebased. Both mutations re-proved red on the merged file, all gates green.

## Rebase over PR #385 — what was resolved

#385 rewrote much of this file: it added §6 (decoration measured where placed) and §7
(torch fire/bracket/soot agree), replaced the old "NOT YET WRITTEN" note, and already
imports `./headless-canvas.mjs` and `type Object3D`. Both sets of assertions are kept.

- **Numbering.** #385 owns §1–§7. My scene-graph section is now **§8**, at the end.
  No two assertions share a number.
- **`PLATE_BAND`.** Checked, not assumed: it survived the squash as
  `const PLATE_BAND = BEAM_WIDTH;` with `BEAM_WIDTH` exported from `castleFabric.ts`
  and imported here. The `0.4` hand-copy is gone. Nothing to do.
- **A second constant-as-finding, found and fixed.** #385's props summary printed
  `${BUILDING_FLOOR_COUNT} storeys` — the number of storeys the loop *visits*, not the
  number it found anything on, so it would have stayed at 5 on the day `dressCastle`
  stopped placing anything. Replaced with `storeysDressed`, incremented only when a
  storey actually yielded placed decoration. Both summary lines are now all-counted.

**#385's assertions did not catch either mutation** — only §8 did. They dress a fresh
`Group` with `CastleFire`/`dressCastle` and never touch `BuildingShell`, so the two
sections overlap less than one might assume: #385 measures the decoration, §8 measures
whether the room it hangs in has a ceiling and a floor.

## What was wrong

Every assertion in `scripts/check-castle.mts` called `buildCeilingBeams(deck)` itself
and measured the returned `InstancedMesh`. Nothing asked whether `BuildingShell` ever
added it to a floor group, or whether the deck slab got its flagstone material. The
headline "4 enclosed storeys" was `TOP_DECK` — a constant printed as a finding, which
is why the blindness was invisible.

## What was added — assertion 8

One new section. It constructs a real `BuildingShell('interior')` and counts what it
finds in the tree, per storey:

- `deck-N` slab present, and its material's `map` is identity-equal to
  `castleFlagstoneTexture()` (the texture cache memoises, so identity is a valid test)
- `walls-N` present, `map` identity-equal to `castleCoursingTexture()`
- `castle-timber-plate-N` present, an `InstancedMesh` with `count > 0`, and its
  **world-space** underside equals `deck × BUILDING_FLOOR_HEIGHT + BEAM_UNDERSIDE`
  (so a plate parented to the wrong floor group is a named failure)
- the roof terrace has **no** plate

Nothing existing was weakened. #385's §1–§7 are untouched apart from the two
counter fixes described above.

## Red proof, re-run on the rebased file

**The mutations are against `Shell.ts` on `1b8b436d`**, i.e. `floor.add(beams)` inside
`BuildingShell`'s enclosed-deck branch, and the `isCastleFloor ? ... : ...` ternary in
`buildDeck`. If either of those lines moves, the reproduction has to move with it.

Mutation 1 — `void beams;` in place of `floor.add(beams)`: **exit 1**, 5 failures, e.g.
`scene: storey 0 is an enclosed storey with no ceiling — 'castle-timber-plate-0' was
built but never added to the shell`. Nothing in §1–§7 fired.

Mutation 2 — `interiorMaterial(colour, 0.82)` in place of
`isCastleFloor ? castleFloorMaterial(colour) : ...`: **exit 1**, 5 failures, e.g.
`scene: the deck-0 slab in the built shell carries no flagstone map`. Again nothing in
§1–§7 fired.

Both reverted; `git status src/` clean; `check:castle` exit 0 on unmodified source.

## Gates (all re-run after `npm ci` in this worktree)

`tsc --noEmit` 0 · `npm run build` (unpiped, 47 steps) 0 · `npm run test:procgen` 0
(14 files, 453 tests) · `check:castle` 0 · `check:park` 0. `check:park-boot` passed
inside the build chain — no #324 flake.

**A trap worth knowing:** a git worktree does not inherit `node_modules`. Re-creating
this worktree left it without one, and Node resolved `three`/`vite` by walking up to
the shared checkout's `node_modules` — so `tsc` and `check:castle` ran and looked fine
while `vitest` was simply missing and `test:procgen` exited 127. **`npm ci` in the
worktree before believing any gate.**

## Hand-copied constants

`PLATE_BAND` is fixed on `main` and survived the squash: `const PLATE_BAND =
BEAM_WIDTH;`, with `BEAM_WIDTH` now `export`ed from `castleFabric.ts`. Verified in the
merged file, not assumed. Nothing in §8 is copied by value.
`EXTERIOR_MASONRY_PATTERN` remains the documented, deliberate duplicate of
`parkFacts.ts` (it fails safe — false pass here, loud `test:procgen` failure).

`package.json` is untouched; the `build` chain still contains `npm run check:castle` as
an exact step (verified by parsing `scripts`, not by grep).
