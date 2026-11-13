# HANDOFF — perf step 15: Reptile House light budget

Plan: `docs/perf/FRAME-DROPS-2026-11.md` on `origin/perf/frame-drops-2026-11` (PR #746), item 9.
Goal: <= 4 dynamic point lights visible in the Reptile House; the rest become emissive / baked pools.
Visible change (Jim judges): before/after screenshots from the same spots, deep link `/reptile-house`.

- Branch `perf-step15-reptile-lights`, worktree `.claude/worktrees/perf-step15`.
- Avoid `ReptileHouse.ts` (PR #758 edits it). All lighting lives in `src/world/reptileHouse/lighting.ts`.
- Today's lighting.ts: 1 directional + 1 hemi + 6 warm pools (3.2, 30 m, decay 1, y 5) + pink nursery lamp + blue grotto mist = 8 point lights.
- Harness: copies of `docs/perf/frame-drops-2026-11-harness/{run,probe,analyse}.mjs` from the perf branch, in the session scratchpad `step15/`.
- Dev server: own port 5781 (--strictPort). Kill by PID when done.

## Status
- [ ] light inventory inside (which point lights are visible — doc says 11)
- [ ] baseline screenshots + frame measurement
- [ ] implement
- [ ] after screenshots + measurement
- [ ] check, test:procgen, PR
