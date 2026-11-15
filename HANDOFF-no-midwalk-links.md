# Handoff: no shader links mid-walk (fix/no-midwalk-shader-links)

Jim's iPhone: after a continued save, long pauses within ~5 s of walking
(cpuP99 247 ms, worst interval 485 ms). Goal: after reveal on any boot path,
walking anywhere in the park creates zero programs and no frame waits on a link.

## Root causes (measured, seed 5)

- Overseer's 150–507 ms frames were on a **Vite dev server**. On a production
  build (WebKit, M4, his route) the walk's worst frame was 26 ms; programs
  49 at reveal -> 70 at end. The links are cheap on an M4; on a phone not.
- Main, full tour (`check:no-midwalk-links`, spawn boot): **107 programs made
  after reveal, 95 first uses waited on a link**. By class:
  1. **ShaderWarmup double-counts lights**: `compile(node, cam, scene)` gathers
     lights from `scene` *and* `node`, so the ferris/train slices compiled with
     4 point lights instead of 3: 11 wasted programs.
  2. **That keys the next shadow pass wrong**: three's `render()` runs
     `shadowMap.render` BEFORE `setupLights()`, and `compile()` shares the
     depth-0 render state: 6+ depth programs per polluted frame.
  3. **Night light count**: LampPosts/FairyLights toggle `light.visible`;
     light counts are in every program key (all materials). Dusk at 17:38
     (~60 s into a fresh game; DAY_LENGTH 150 s): 17 programs on that frame,
     then the lamp hand-over hid a light so the count wandered 9<->10.
  4. **Statue fade** flips `material.transparent` -> new variants.
  5. **Shadow depth programs** for casters outside the sun's frustum at warm
     time (e.g. ginormous-slide-chute, DoubleSide).
  6. **smoke-puffs** instanceColor made lazily by the first setColorAt.

## The fix (commits on the branch)

- `ShaderWarmup` is the one owner (`Game.parkWarmup`): slices as `ObjectList`
  (no double count), under both `World.parkLightings()`, the
  `FoliageFade.fadedVariant()`, depth proxies for every caster (replica of
  three r185 getDepthMaterial; compiled with a 1x1 RT bound and fog off),
  then link poll (COMPLETION_STATUS), first use (getUniforms) of every
  program, textures. `relight()` after each advance undoes the render-state
  side effect.
- `RevealHold.setWork`: every cover over the park carries it; boot limit 15 s.
- main.ts: bus drives `game.parkWarmup`; any boot with it unfinished holds.
- `warmTheRestInBackground` removed; `finishLeftoverWarmup` only runs if a
  cover timed out.
- LampPosts: hand-over dims, never hides (`PARK_LIGHTS_ON_ABOVE`).
- puffs.ts: instance colours at construction.

## Guard

`scripts/check-no-midwalk-links.mts` (served, dev server, window.game).
Red on main (above). Green on branch: spawn boot 103 programs at reveal ->
103 after 196 stops, light counts 7/15.

## TODO
- rebase onto main (has #785; conflicts in Game.ts/shaderWarmup.ts)
- wire into package.json + with-dev-server env + a shard; chain-coverage
- prod measurements main vs branch, interleaved (attrwalk.mjs, #785 on main)
- pnpm run check, test:procgen; PR

## Servers I started (kill by PID)
- dev 6311 (branch), dev 6312 (main worktree no-midwalk-main), attr preview 6313
