# HANDOFF — perf step 4: cull the crowd

Branch `perf-step4-cull-crowd`, worktree `.claude/worktrees/perf-step4`
(and `.claude/worktrees/perf-step4-base` = origin/main for before-builds; remove both at the end).
Spec: docs/perf/FRAME-DROPS-2026-11.md item 4 (on PR #746's branch).

## Design (implemented)
1. `InstancedCrowd.commit` records each member's chosen variant + matrix (no buffer writes).
2. `flush` packs every variant mesh with only the members wearing it (slots 0..count-1,
   `count`, `visible = count>0`, `boundingSphere` = union of those instances + 0.1 m,
   `frustumCulled = true`) and stores a per-member sphere. Always correct to draw.
3. `cullCrowdsFor(scene, camera)` (called in `Game.render` right before the world draw)
   repacks NON-shadow-casting parts with only members whose sphere meets the frustum.
   Shadow casters keep everyone (shared buffer feeds the shadow pass; >1 shadow light).
- Slot != member now; nothing reads crowd instance ids (Highlights only for Flowers).

## Check
`scripts/check-crowd-cull.mts` (`check:crowd-cull`, appended to `check:crowd`).
Truth = committed member skeletons (watched via patched commit), part enclosing spheres
computed by the check itself. Asserts no on-screen / in-shadow-frustum part culled or
missing from the buffer; off-screen tris/pose <= budget (park, interior).
Mutations: `--mutate=centre|stale|uncull`.
Dev runs: `LGP_PARK_RESTART=1 ROUNDS=1` (seed 5 accepted restart is 1) — otherwise the
harness runs the park acceptance loop (~4 min/restart) because src changed.

## Findings
- Before (main code, ROUNDS=1): park 64 crowd draws/pose, 1,645,472 crowd tris, 1,602,306 off screen;
  interiors (origin poses) 1,643,779 of 1,645,472 off screen.
- Old check bugs fixed: box-vs-frustum truth (conservative corners) -> use spheres;
  float32 slot comparison at 600 m; interiors hidden headless -> show crowd ancestors.

## Status
- [x] before numbers (check)  - [ ] after numbers  - [ ] red proofs  - [ ] browser A/B  - [ ] PR
