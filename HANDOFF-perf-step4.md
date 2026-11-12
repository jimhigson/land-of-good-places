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

- After (ROUNDS=1, seed 5): park 31.6 draws/pose, 131,898 crowd tris, 0 non-shadow off screen,
  86,986 shadow-casting off screen; interior (4234 poses, banquet-heavy) 1,252,327 tris,
  0 non-shadow off screen, 435,527 shadow. PASS (exit 0, 208 s).
- Red proofs: --mutate=centre exit 1 (27,160 failures: missing on-screen instances),
  --mutate=stale exit 1 (16,108: culled from main pass), --mutate=uncull exit 1
  (293,565 non-shadow off-screen tris/pose park).

## Status
- [x] check numbers  - [x] red proofs  - [ ] browser A/B (build base + branch, harness run.mjs)
- [x] PR #756 (draft)

## Browser A/B v1 (head 974b8bea, before the bounds optimisation)
Harness: PR #746's run.mjs + my ab.sh (scratchpad), Chrome for Testing 1234 headless, M4 Pro,
vite preview of base (9b5e89e3) on :5871 and branch on :5872, seed 5.
Tris p50: park 3.66 M -> 1.47 M; reptile 2.09 -> 0.45; library 1.99 -> 0.35;
castle hall 14.47 -> 1.67; castle mall 2.63 -> 0.19. Draws -40..-95.
CPU p50 park went UP ~0.5 ms: node bench showed flush on the 111-seat banquet (0.28 ms) +
culling the hidden banquet (0.08 ms). Fixed in "per-child boxes" commit: banquet flush 0.059,
cull skipped when hidden; park crowd total 0.103 ms vs main 0.109. Re-measuring (v2).
Note: `pnpm run build` exits 1 on main and here (PWA precache limit, #749); dist is complete.
Parks are source-hash gated: rebuild with `LGP_SEEDS=5 LGP_RESTART_LANES=2 pnpm run build:parks`.
