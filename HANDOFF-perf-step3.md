# HANDOFF — perf steps 2 + 3 (space detach, don't update what isn't drawn)

Branch `perf-step3-undrawn`, worktree `.claude/worktrees/perf-step3`, dev server port 5811. Plan: `git show
origin/perf/frame-drops-2026-11:docs/perf/FRAME-DROPS-2026-11.md`, items 2 and 3. One of 12 packages; NO PR — the
integrator merges into perf/120fps. Must merge `origin/perf/120fps-base` (with `-c rerere.enabled=false`) before the final push.

## The mechanism (one owner)
- `src/world/DrawnSpaces.ts` — the write side. `World` registers each interior root instead of `scene.add`; an accessor
  on the root's `visible` makes the owner's existing writes (every door/lift/deep link/save) attach or detach it from the
  scene immediately, with `updateMatrixWorld(true)` on attach. Labels are the space-id stems (`castle`, `hotel`,
  `reptileHouse`, `library`).
- `src/core/drawn.ts` `isDrawn(object)` — the read side (visible all the way up to a Scene). Gates the banquet and the
  roof garden in `Building.update`; `WildPets.passUnseen` banks unseen time and the first drawn frame lives it.
- Detaching is switched on by `Game` only (`world.drawnSpaces.detachUndrawn()`); a headless `World` (Node checks, park
  digest) keeps one graph.
- `shaderWarmup.ts` is handed `drawnSpaces.detachedRoots()` so it compiles what it compiled before.
- `World.setElsewhereVisible` restores what it hid (it used to switch the castle interior ON in the park after a ferris ride).

## Findings
- Reptile cases, library creatures: already gated on `inside`. Library children: NpcSystem residents, frozen by #362's
  `elsewhere` mark. Banquet + wild pets: gated here.
- Only `shaderWarmup` walks the whole scene in `src/` (grep: scene.traverse / getObjectByName / intersectObjects(scene).

## Guards
- `check:render-budget` (served): per space, scene-graph census; a registered root of another space reachable from the
  scene fails. `MUTATE=reattach` proves it red.
- `check:undrawn-still` (Node, script entry added, NOT wired into a shard): nothing under a hidden ancestor changes frame
  to frame; `-- --mutate` proves it red.

## Not done
- The park while she is indoors: its groups stay attached and its updaters still run. Needs a pixel proof per interior
  (hotel garden/ocean rooms, castle roof, reptile forecourt) that nothing of the park is in frame before detaching.
- Lazy library/hotel roots on the base branch: check they still reach `World`'s register lines after the merge.
