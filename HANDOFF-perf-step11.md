# HANDOFF — perf step 11, NPC simulation LOD

Branch `perf-step11-npc-sim-lod`, worktree `.claude/worktrees/perf-step11`.
`origin/perf/120fps-base` is merged in (ef8c78f1). No PR: the integrator merges this into `perf/120fps`.

## What is built

- `src/entities/npc/simLod.ts` (new): `NpcView` is the one definition of "on screen" for NPC
  simulation (child's sphere + 4 m against the frustum of the camera that last drew the park);
  `NpcSimLod` is the staggered schedule and the banked time.
- `NpcSystem.update`: a child nobody can see steers every 2nd frame and is posed and committed
  every 4th, with the skipped `dt` handed to her next step whole. `steppedEveryFrame` is the one
  place deciding who may be throttled. The old "beyond 34 m, every other frame" rule is gone.
- `NpcCharacter.update` takes a trailing `pose` flag.
- `Game.render`: one line, `noteNpcViewCamera(camera)`, after `cullCrowdsFor`.
- `scripts/check-npc-sim-lod.mts` + its `check:npc-sim-lod` script entry (not in any shard).

## NOT DONE — read this first

**`check:npc-sim-lod` has never completed a run, so nothing here is measured and the check is
not proved red.** Editing `NpcSystem.ts` changes the park source hash, the headless harness then
re-solves seed 5, and on 13 Nov with the Mac at load 35 that solve had not finished after 13
minutes. `tsc --noEmit` and `typecheck:test` pass; the new code has not executed once.

To finish: `pnpm run check:npc-sim-lod` (green), then `--mutate=no-throttle`, `--mutate=blind`,
`--mutate=drop-banked` (each must exit 1 with numbers). Paste the counts it prints to stderr.
Things most likely to need a touch when it first runs: the walker circuit in part 4 is a 6 m
square round the player's spawn and may be blocked by the bus stop (the check says so if it is);
`DRIFT_ALLOWED` is 10 cm on reasoning (about 4 cm lost per corner), not on a measurement.

Then run the checks that step the crowd headless, because with no camera noted everybody now
runs at full rate where far children used to run at half: `check:npc-jitter`,
`check:npc-separation`, `check:npc-dispersal`, `check:npc-presence`, `check:crowd-cull`,
`check:speech-bubbles`, `check:cat-bus`, `check:hotel`.
