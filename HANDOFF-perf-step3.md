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

## State at hand-back (13 Nov, 09:45)
- `origin/perf/120fps-base` (8cae5514) merged with rerere off, no conflicts. Lazy hotel/library keep the same root objects
  (`hotelRoot`, `roomRoot`) and write `visible` on them, so `World`'s register lines cover them with no edit to
  `Hotel.ts` / `Library.ts` / `interior.ts` / `room.ts`.
- `tsc --noEmit` 0, `typecheck:test` 0 on the merged head. `vitest run test/store/drawn-spaces.test.ts`: 2 passed.
- **NOT RUN IN A BROWSER.** The dev server (5811) never finished building seed 5: World.ts/Building.ts are in the park
  source closure, every edit re-keyed the cache, and with the Mac at load 30 one solve attempt took ~9 min. Restart 0
  and 1 attempts are cached in `.parks/dev/d57c770f7c65e53f/5/.attempts` (hash of the merged head).
  So: no before/after counts, `check:render-budget`'s new census never ran green, `MUTATE=reattach` never ran red,
  `check:undrawn-still` never ran on this head (green or `--mutate`), wild-pets catch-up test never ran.
- First thing to do next: `pnpm exec vite --port 5811 --strictPort`, wait for "[dev parks] seed 5 built", then
  `CHECK_RENDER_BUDGET_URL=http://127.0.0.1:5811 pnpm run check:render-budget` (green), the same with
  `MUTATE=reattach ONLY=park` (must fail naming a root and its object count), `pnpm run check:undrawn-still` and
  `-- --mutate`, `pnpm exec vitest run test/store/wild-pets-catch.test.ts`. Do not edit World.ts/DrawnSpaces.ts/
  Building.ts before measuring — each edit costs a re-solve.
- Known hole to look at: content added under a root while it is detached and has never been attached since, then read
  by bare `matrixWorld` from another space, reads stale/identity matrices (attach recomputes them). No such reader was
  found (`doorwayExits` is numbers), but the audit was by grep, not by run.
