# HANDOFF — undrawn-indoors (120 fps plan, step 3 + the rest of step 2)

Branch `perf/undrawn-indoors` from `origin/main` (34f20970). Worktree `.claude/worktrees/undrawn-indoors`. Dev port 6011.
No PR: a later stage opens it. Merge `origin/main` with `git -c rerere.enabled=false merge origin/main` before handing over.

## Brief (short)
Nothing updates per frame for a space that is not drawn, unless it must. The clock keeps running. Coming back must be
plausible (ride mid-cycle, train on its loop, crowd sensible). Prefer cheap catch-up on return. Saves made indoors
restore. `owed:undrawn-still` -> real `check:undrawn-still` in a CI shard, with a control. Measure CPU p50/p99 (?perf=1)
park + each interior, x1 and x4 throttle, before and after. Do not touch `boot/shaderWarmup.ts`. Castle edits = updater
gating only (#759 owns how the castle LOADS).

## Prior work found
- `src/world/DrawnSpaces.ts` (write side: `visible` on a registered root = membership of the graph) and
  `src/core/drawn.ts` `isDrawn` (read side). Banquet + wild pets already gated in `Building.update`.
- Old handoff (perf-step3-undrawn branch, merged): reptile cases / library creatures gated on `inside`; library kids are
  NpcSystem residents frozen by #362's `elsewhere` mark. The park while she is indoors: NOT done.
- `owed:undrawn-still` first run: 5384 changes under the undrawn hotel per 600 frames (kid body, statue turntable,
  hotel.lobby, hotel.suite, two shopkeepers).

## State
- (in progress) reading code, building the measurement harness.
