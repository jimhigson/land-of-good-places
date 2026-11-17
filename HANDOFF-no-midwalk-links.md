# Handoff: no shader links mid-walk (fix/no-midwalk-shader-links, PR #787)

Jim's iPhone: after a continued save, long pauses within ~5 s of walking
(cpuP99 247 ms, worst interval 485 ms). Goal: after reveal on any boot path,
walking anywhere in the park creates zero programs and no frame waits on a link.

**State: done and in review.** PR #787's description has every number; this
file is the short version for a replacement.

## Root causes (measured, seed 5)

- Main, `check:no-midwalk-links`: 95 programs made after reveal / 83 first
  uses waiting on a link (deep link); 97/86 continuing a save before dusk;
  68/68 after the bus ride. Classes: warm-up double-counted a slice's lights;
  that keyed the next shadow pass wrong (three draws shadows before
  setupLights); the night light count (lamps/fairy toggle `visible`, lamp
  hand-over hid a light, keychain view hid the lamp group); shadow depth
  programs per caster; statue fade; train smoke's lazy instanceColor.
- Production, M4, continued save at dusk on main: 1122 ms (WebKit) and
  1454 ms (Chromium) frozen frames, 1.9–3.4 s of link waits. Branch: 0.
- Branch first-run dusk had a 335–413 ms GPU-process gap (pipeline builds on
  first draw, cold system shader cache); fixed by `drawEverything` (4588eda1).

## The fix

`ShaderWarmup` (`Game.parkWarmup`) warms every slice under both
`World.parkLightings()`, the statue faded, every caster's depth program,
then links, first-uses, uploads textures and draws the whole park once per
lighting in the cover's `behind` frame. `RevealHold.setWork` carries it on
every cover over the park (progress-based limit). Bus drives it; any boot
with it unfinished holds. `warmTheRestInBackground` removed.

## Guard

`check:no-midwalk-links`, four boots: CI shard 13 (spawn + continue,
`check:served-no-midwalk-links`) and 14 (bus + skip, `-bus`). Red on main,
green on the branch locally (Metal and SwiftShader). CI history: 9af7be20
clean counts but bus/skip dusk never reached night (fixed 1691b953, crossing
waits on the light count); 84649138 ran out shard 13's watchdog with all
four boots (fixed 753531b0: two shards, one round trip a stop, 30 m grid).
Local SwiftShader shard 13 after the fix: 221 s.

## If you pick this up

- Wait for CI on the PR head; shard 13 is the new one (~15–21 min).
- `pnpm run check` was running locally at handoff time.
- No servers or extra worktrees left running.
