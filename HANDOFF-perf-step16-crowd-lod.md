# Handoff — crowd render LOD (120 fps plan, step 16)

Branch `perf-step16-crowd-lod`, worktree `.claude/worktrees/perf-step16`, dev port 5813.
No PR: the integrator merges this into `perf/120fps`. `origin/perf/120fps-base` is merged in.

## What is built

- `src/core/instancedLod.ts` (new, shared): `lowDetailGeometry` (far level derived at
  load from the geometry it replaces, vertex clustering, ≤ 25 % of the triangles),
  `projectedDiameterPx` + `nextLodLevel` (level by on-screen size, with hysteresis),
  and `?lod=off` / `setLodEnabled` for a same-frame A/B.
- `src/entities/npc/InstancedCrowd.ts`: every part variant has a second instanced
  mesh (`…:low`); `cullTo(frustum, view)` puts each child in exactly one. Off-screen
  children kept for their shadow are always the far level.
- `src/Game.ts`: one hunk — passes `renderer.domElement.height` to `cullCrowdsFor`.
- `scripts/check-crowd-cull.mts`: knows both meshes; asserts one level per child,
  the far level under the ordinary camera (at 3× DPR), every far level in budget.

## Facts measured

- The crowd child was never an authored low/high pair: the prototype is `createKid`
  (GLB body + parametric bags/hair), 44 parts, 39,968 triangles over every style.
- One child, full detail: 14.4 k–21.1 k triangles depending on hair/bag/shoe.
- The sphere `InstancedCrowd` keeps round a child is ~2.0–2.4 × her `height`
  (headless, scale 1) — the thresholds in `instancedLod.ts` are on that sphere.

## Not done

- The shadow pass draws full detail for a child the main pass is drawing at full
  detail (a close-up). Exact "shadow always low" needs per-pass instance counts
  (`onBeforeShadow`/`onAfterShadow` on the far mesh) — not attempted.
- No screen-space-error tuning of the 25 % ratio near the 150 px switch.

## Proving the new guards red

```
pnpm run check:crowd-cull -- --mutate=both-levels
pnpm run check:crowd-cull -- --mutate=full-detail
```
