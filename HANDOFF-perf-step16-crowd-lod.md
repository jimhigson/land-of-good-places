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

## NOT verified — do these first

- **`check:crowd-cull` has never completed on this branch.** Its park acceptance
  loop for seed 5 did not finish in 7 minutes at load average 38 and was killed.
  The edits to it (two meshes per variant, the three new assertions, both new
  mutations) are type-checked only; neither new guard has been watched go red.
- **Nothing was measured in the game.** No park-spawn or `/rail-race` triangle
  counts, no in-game screenshots; the `Game.ts` hunk and `?lod=off` were never
  exercised. Counts and screenshots came from a standalone page (9 children,
  one per hairstyle, own lights): crowd main-pass triangles 161,528 -> 35,352,
  frame 207,466 -> 45,956, draw calls 54 -> 54; 214 instances in every state.
- Pets and banquet diners (the other `InstancedCrowd` users) now get a far
  level too and were never looked at.

## Seen wrong in the far level (visible)

- **Spiky hair** drops from a dozen spikes to about three blunt ones — visible
  in a 4x crop even at 23 px tall, obvious at 60-110 px. Vertex clustering
  merges the cone tips. Needs a gentler ratio for that part or a tip-keeping
  rule before this is "indistinguishable".
- Speckle on the sandals and a stray sliver by one bag strap at 60-110 px.

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

## Review fixes, 13 Nov 09:50-10:00 (second engineer)

Both blocking findings were real; both are changed in `c36ddb9f`, base re-merged after.

- **Far level visibly wrong at reachable sizes.** Two changes in `src/core/instancedLod.ts`:
  - Thresholds 340/280 -> **120/100 px of bounding sphere** (child goes full at
    50-59 px tall, back at 41-49). At `CAMERA_ZOOM_MAX` she is 125-190 px: always
    the authored model now. The far level is only for the zoom-1 camera.
  - `lowDetailGeometry` **refuses a far level whose surface area is more than 20 %
    from its source's** (`LOD_MAX_SURFACE_CHANGE`, `surfaceChange`). Measured headless
    over the 44 prototype parts: 7 refused — collar 0.77, hem 0.77, the 620-triangle
    part under each leg 0.58, hair.drape 2808 triangles 0.77, hair.drape 256
    triangles 1.26, a 216-triangle crown sphere 0.65. 37 keep a far level, worst
    17.1 %. Prototype far total 8,480 -> 13,015 of 39,968 triangles.
  - A minimum-grid rule was tried first and **disproved by measurement**: the torso
    clusters on a 4-cell grid and looked fine, the spiky hair on a 10-cell one and
    did not. Grid size does not predict what fails; area change does separate them.
  - **Inferred, not looked at:** that the 2808-triangle `hair.drape` geometry is the
    spiky hair and the 620-triangle leg part is the sandal. Nothing was re-shot.
    The strap sliver is not known to be caught. No evidence exists between 23 and
    60 px of child height, and the switch is now at ~50.
- **`check:crowd-cull` contradicted its own poses.** Confirmed by reading: half the
  park poses are at `CAMERA_ZOOM_MAX` (the flag is called `zoomedOut`; it zooms in).
  The far level is now required on **park poses at zoom 1 only**; every pose still
  requires one level per child; interiors assert one level, not which. Every far
  level must be inside `LOD_MAX_SURFACE_CHANGE`; a part refused a far level is
  announced on stderr instead of failing. Three "measured nothing" guards.

Still to do first: **run `check:crowd-cull` to the end and prove `--mutate=both-levels`
and `--mutate=full-detail` red.** Every edit to `instancedLod.ts` changes the park
source hash, so each run starts with a seed-5 acceptance loop.
