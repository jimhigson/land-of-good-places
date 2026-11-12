# HANDOFF — perf step 4: cull the crowd

Branch `perf-step4-cull-crowd`, worktree `.claude/worktrees/perf-step4`.
Spec: docs/perf/FRAME-DROPS-2026-11.md item 4 (on PR #746's branch).

## Design (decided)
- `InstancedCrowd.commit` records each member's chosen variant + matrix (no buffer writes).
- `flush` packs every variant mesh: only members wearing it, slots 0..count-1,
  `mesh.count = n`, `visible = n > 0`, `boundingSphere` = union of exactly those
  instances (+0.1 m). `frustumCulled = true`. Shadow pass culls with the same sphere
  against the shadow camera — correct for off-screen kids' shadows.
- Gain: hidden variants (faces x eye colours, hair, bags, shoes) no longer drawn as
  zero-scaled instances; whole crowd culled indoors.
- Slot != member now; nothing reads crowd instance ids (checked: Highlights only
  instance-highlights Flowers).

## Check
`scripts/check-crowd-cull.mts` (`check:crowd-cull`, appended to `check:crowd`).
Truth from member skeletons, not the buffer. Mutations `--mutate=stale|uncull`.

## Status
- [ ] before numbers  - [ ] after numbers  - [ ] red proofs  - [ ] PR
