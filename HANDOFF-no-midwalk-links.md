# Handoff: no shader links mid-walk (fix/no-midwalk-shader-links)

Jim's iPhone: after a continued save, long pauses within ~5 s of walking
(cpuP99 247 ms, worst interval 485 ms). Goal: after reveal on any boot path,
walking anywhere in the park creates zero programs and no frame waits on a link.

## Root causes (measured, seed 5)

- Overseer's 150–507 ms frames were on a **Vite dev server**. Production build
  (WebKit, M4, his route): worst frame 25–27 ms; links cheap on an M4.
- `check:no-midwalk-links` on main 44952060, spawn boot: **95 programs made
  after reveal, 83 first uses waited on a link** (park stops only). Classes:
  1. ShaderWarmup double-counted a slice's own lights (`compile(node,..,scene)`).
  2. That keyed the next shadow pass wrong (three runs the shadow pass before
     setupLights; compile shares the depth-0 render state).
  3. Night light count (lamps/fairy toggle `visible`; lamp hand-over hid a
     light; keychain view hid the lamp group). Light counts are in every key.
  4. Shadow depth programs for casters outside the sun frustum at warm time.
  5. Statue fade (`transparent` flip). 6. smoke-puffs lazy instanceColor.

## The fix (all pushed)

- `ShaderWarmup` = one owner (`Game.parkWarmup`): ObjectList slices, both
  `World.parkLightings()`, `FoliageFade.fadedVariant()`, depth proxies (replica
  of three r185 getDepthMaterial, compiled with a 1x1 RT and fog off), link
  poll, first use of EVERY program, textures; `relight()` after each share.
- `RevealHold.setWork`: every cover over the park carries it; limit is
  progress-based (4 s without progress, 60 s cap).
- main.ts: bus drives `game.parkWarmup`; any boot with it unfinished holds.
- `warmTheRestInBackground` removed (leftover only after a timed-out cover).
- LampPosts: hand-over dims; keychain view hides posts not lights.
- puffs.ts instance colours at construction. Rebased on #785 (perf report
  now has `parkWarmup`; context has `programs`).

## Guard: check:served-no-midwalk-links (shard 13)

Branch: 0 made / 0 first uses on spawn (198 stops), continue (106), bus.

## Prod (M4, interleaved) spawn walk: main 4 programs + 8 link waits per
walk, branch 0/0; reveal ~same (+0–0.2 s).

## TODO
- prod continue + bus boots (prodwalk.mjs); pnpm run check; test:procgen;
  gpu:first-entry locally; PR.

## Servers I started (kill by PID)
- dev 6311 (branch, node 42058), dev 6312 (main, node 35604),
  preview 6314 (main, node 43384), preview 6315 (branch, node 43385)
- worktrees: no-midwalk-main (detached main), no-midwalk-attr (scratch, delete)
