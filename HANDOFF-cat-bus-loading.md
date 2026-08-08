# HANDOFF: cat bus loading screen (`e-cat-bus-loading`)

The last piece of #245 / PR #246: **making the ride actually cover the park's
generation**, not just the 442 ms `World` build.

**Read first:** `HANDOFF-cat-bus-stage-b.md` (same tree) — its "NOT DONE" section
is this task's brief, and its plan is the one I followed. Then
`HANDOFF-cat-bus-stage-a.md`.

Worktree `/Users/jim/dev/landOfGoodPlaces/.claude/worktrees/e-cat-bus-loading`,
branch `e-cat-bus-loading-work`, off `origin/e/cat-bus-stage-a` @ `cbcdd78`.
**Pushes to `e/cat-bus-stage-a`** (PR #246's head) — that branch name is checked
out in another worktree, hence the local one. `npm ci` exit 0.

The local `e/cat-bus-stage-a` in the shared checkout was **19 commits behind
origin** when I started. Base off `origin/`, not the local branch.

**My dev server port is 5477.** 5200 / 5210 / 5410 / 5412 are other people's;
5418 was Stage A's.

## What was built

**The ride now covers ~4 s of module-scope generation, not 442 ms.**

- `rail/generate.ts`: `railRouteSearch` is a generator yielding at each attempt
  **and each joint**; `solveRailRoute` is a four-line driver over it. Yields are
  inert — the whole search state is generator locals, the `Rng` above all — so
  the draw order cannot change.
- `slide/plan.ts` split into **`solve.ts` (how) and `plan.ts` (what)**. Forced:
  something must build the brief without importing the module that owns
  `SLIDE_PLAN`, and the two cannot import each other (TDZ cycle). The name
  stayed with the const, so **no call site changed**.
- `slide/prewarm.ts`: a take-once letterbox, `import type` only so there is no
  runtime edge.
- `boot/parkGeneration.ts`: five ride plans one `import()` per frame, then the
  slide's 3.46 s search sliced at `GENERATION_BUDGET_MS` (8 ms). No DOM, no
  `Game`, so a check can drive it.
- `main.ts`: `import type { Game }` — the one word that lets the ride start
  before the park's code is evaluated. `arrivalIsDue` moved to `arrivalFlag.ts`
  so asking it does not import `terrain`/`boundary`.
- `journeyDirector.ts`: `shouldBuildPark()` now **requires generation to be
  finished**.

## Measured

`check:park-boot` (new, in the build chain), canonical seed:

```
generation finished in 441 frames / 3.66 s wall clock, 3.52 s inside advance()
worst single advance() 8.8 ms against an 8 ms budget
worst the event loop was blocked: 47.4 ms, over one 60 Hz frame on 3 occasions
134 ms of generation happened outside a budgeted slice
sliced and straight-through solves are identical: same route SHA, same chute SHA
```

**Byte-identity proved twice**: `measure:slide-fingerprint` on all five sweep
seeds before/after the refactor is identical (route SHA, chute SHA, length,
segments, minCurv, startPoseIndex, backtracks, candidate counts); and
`check:park-boot` re-proves it per run, in one process, for the pre-warmed path.

## Six mutations, all red

| mutation | went red with |
|---|---|
| joint-level yield removed | worst advance 69.0 ms; 88 frames over one frame long |
| frame budget ignored | 8 frames; one 3787 ms block — 227 dropped frames |
| `plan.ts` ignores the pre-warm | plan still in the letterbox; 4.70 s unbudgeted |
| pre-warm never offered | 4.80 s unbudgeted (slot legitimately empty) |
| sliced solve given a different seed | 74.95 m vs 68.75 m, both hashes differ |
| `shouldBuildPark` drops the generation gate | World built while still generating |

**One of my own assertions could not fail and the mutations found it.** I first
asserted that importing `slide/plan.ts` after the ride was fast. It is *always*
fast — `ParkGeneration` imports `world/paths`, which imports `slide/plan`, so it
is already cached whatever happened; under the mutation it still said 0 ms.
Replaced by two complementary assertions (letterbox empty + no unbudgeted work),
and mutation 4 exists specifically because only the second one catches it.

Worth knowing: mutation 1 leaves the route **identical** while blowing the
timing assertions apart. That is the evidence the timing and equality halves
measure different things.

## Status

- [x] Read CLAUDE.md, ARCHITECTURE*.md, Stage B handoff, PR #246 body
- [x] Own worktree off `origin/e/cat-bus-stage-a`, `npm ci` exit 0
- [x] Pristine fingerprints captured for all 5 seeds before touching anything
- [x] `solveRailRoute` resumable; byte-identical on 5 seeds
- [x] `plan.ts` split; prewarm letterbox
- [x] Boot stepper driven from the ride loop; hand-over gated on it
- [x] `check:park-boot` + 6 mutations proved red
- [ ] Full `npm run build` + `test:procgen` re-run after the guard landed
- [ ] Watched end to end in headless Chromium, frame timings + screenshots
- [ ] Pushed, PR #246 updated
