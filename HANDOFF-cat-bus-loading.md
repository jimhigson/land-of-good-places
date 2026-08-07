# HANDOFF: cat bus loading screen (`e-cat-bus-loading`)

The last piece of #245 / PR #246: **making the ride actually cover the park's
generation**, not just the 442 ms `World` build.

**Read first:** `HANDOFF-cat-bus-stage-b.md` (same tree) — its "NOT DONE" section
is this task's brief, and its plan is the one being followed. Then
`HANDOFF-cat-bus-stage-a.md`.

Worktree `/Users/jim/dev/landOfGoodPlaces/.claude/worktrees/e-cat-bus-loading`,
branch `e-cat-bus-loading-work`, off `origin/e/cat-bus-stage-a` @ `cbcdd78`.
**Pushes to `e/cat-bus-stage-a`** (PR #246's head) — that branch name is checked
out in another worktree, hence the local one. `npm ci` exit 0.

The local `e/cat-bus-stage-a` in the shared checkout was **19 commits behind
origin** when I started. Base off `origin/`, not the local branch.

## The design, and the one thing that forces its shape

The 3.46 s is a single `solveRailRoute` call inside `planSlide()`, and
`planSlide()` runs at module scope of `src/world/slide/plan.ts`. To advance it a
slice at a time, something has to be able to **build the brief without importing
the module that owns `SLIDE_PLAN`** — importing that module is what runs the
solve.

That is why the file splits. `plan.ts` cannot both hold the code and hold the
const: a module that re-exported the const would be a cycle (`plan.ts` ->
const-owner -> `plan.ts`), and the const's initialiser would run while `plan.ts`
was still in TDZ for `SLIDE_VOCABULARY` and friends. So:

- **`slide/planner.ts`** — all of today's `plan.ts` except the final const.
  Cheap to import. Exports `slideRouteBrief()`, `finishSlidePlan(route)`,
  `planSlide()`.
- **`slide/plan.ts`** — thin; re-exports `planner` and owns
  `export const SLIDE_PLAN = takePrewarmedSlide() ?? planSlide()`.
  **All 15 consumer import sites are unchanged.**
- **`slide/prewarm.ts`** — a one-slot cache. `import type` only, so no runtime
  edge back to `planner`.

`solveRailRoute` becomes a thin driver over a new generator. Yields do not
change a single RNG draw, so the route is byte-identical by construction — and
that is *proved*, not argued, by solving twice in one process and comparing.

## Status

- [x] Read CLAUDE.md, ARCHITECTURE*.md, Stage B handoff, PR #246 body
- [x] Own worktree off `origin/e/cat-bus-stage-a`, `npm ci` exit 0
- [ ] Baseline build + `test:procgen` + `measure:slide-boot` recorded
- [ ] `solveRailRoute` resumable
- [ ] `plan.ts` split; prewarm cache
- [ ] Boot stepper driven from the ride loop
- [ ] Guards + mutations
- [ ] Watched in headless Chromium, frame timings reported
