# Handoff: no shader links mid-walk (fix/no-midwalk-shader-links)

Jim's iPhone: after a continued save, long pauses within ~5 s of walking
(cpuP99 247 ms, worst interval 485 ms). Goal: after reveal on any boot path,
walking anywhere in the park creates zero programs and no frame waits on a link.

## Findings so far (15 Nov)

- Overseer's 150–507 ms frames were on a **Vite dev server**. On a production
  build (#785's attribution merged into a scratch worktree, WebKit, M4, his
  route) the walk's worst frame was 26 ms; programs 49 at reveal -> 70 at end.
  So on the M4 the links are cheap; on a phone each one is not.
- The ~21 programs born after reveal, by class (dev, seed 5, /spawn?pos=0,0):
  1. **ShaderWarmup double-counts lights.** `renderer.compile(node, cam, scene)`
     gathers lights from `scene.traverseVisible` *and* `node.traverseVisible`,
     so a slice containing a point light (fountain glow, ferris hub, train
     headlight) compiles with numPointLights 4 instead of 3: 11 wasted programs.
  2. **That pollutes the next shadow pass.** three's `render()` runs
     `shadowMap.render` BEFORE `currentRenderState.setupLights()`, and
     `compile()` shares the depth-0 render state, so the shadow pass after a
     warm-up slice keys depth programs on the phantom count: 6 more programs.
  3. **Statue fade** (`ripikaStatue.setFade`) flips `material.transparent`:
     new variants (opaque bit off; flipSided for the back-face pass).
  4. **Shadow depth programs for casters outside the sun's frustum at warm
     time** (e.g. ginormous-slide-chute, DoubleSide).
  5. smoke-puffs (train smoke) instancing+instanceColor variant, mid-walk.
- **Light counts are in every program's key** (all materials, even basic and
  depth). LampPosts/FairyLights toggle `light.visible` at dusk/dawn and on the
  lamp hand-over -> numPointLights changes -> every material recompiles.
  DAY_LENGTH_SECONDS = 150, so dusk comes ~60 s into a fresh game.

## Scratch tools (not in the repo)

/private/tmp/claude-501/-Users-jim-dev-landOfGoodPlaces/63860b08-4a9b-4597-b7cf-7b1677887a9f/scratchpad/midwalk/
- diagnose.mjs, tour.mjs (dev, window.game), attrwalk.mjs (prod + #785)
- scratch worktree .claude/worktrees/no-midwalk-attr = main + #785, never pushed

## Servers I started (kill by PID)
- dev 6311 (node 20971, pnpm 20961), attribution preview 6313 (node 24712)
