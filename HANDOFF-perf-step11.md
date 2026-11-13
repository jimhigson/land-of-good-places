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

## Measured, 13 Nov (review fix) — seed 5, player at the spawn (-1.6, 51.6)

The acceptance solve at this source hash never finished, so every run below hydrates the seed-5
park file two sibling worktrees solved independently (restart 1, digest `be65f30f3323a8a4`):
`LGP_PARK_FILE=<that 5.json> node --no-warnings --import ./scripts/ts-extension-resolver-register.mjs scripts/<check>.mts`.
**The acceptance loop has still not run at this source hash; CI does that.**

`check:npc-sim-lod`, exit 0, per frame over 600 frames each way, 34 characters:
- throttle off: 24.00 updates, 24.00 poses, 23.00 kid commits
- throttle on: 17.92 updates, 15.02 poses, 14.29 kid commits (12.11 every-frame, 11.61 throttled, peak 5)
- 8279 on-screen child-frames checked, 0 not stepped
- walker: 50.1 m, 8 corners in 20 s; 27.8 cm off at the end, 28.0 cm worst, 38.3 cm allowed

Its first run FAILED on the unmeasured `DRIFT_ALLOWED = 10 cm`. Traced: drift is constant on
every straight (banked time is exact) and grows one stride (about 4.2 cm) at each corner turned a
frame late. The bound is now that arithmetic, per compared frame (`driftAllowedAfter`).

Proved red against that same park, each exit 1 on its own clause:
- `--mutate=no-throttle`: 0.00 throttled; 23.00 kid commits no fewer than 23.00
- `--mutate=blind`: 165 of 8567 on-screen child-frames not stepped
- `--mutate=drop-banked`: 7.5 cm at 0.08 s against 4.3 allowed; 255.0 cm at the end, 792.3 worst

Crowd-stepping checks on the same park: `check:jitter` (npc-jitter), `check:npc-separation`,
`check:npc-dispersal`, `check:npc-presence`, `check:crowd-cull`, `check:speech-bubbles`,
`check:cat-bus`, `check:npc-perch`, `trace-npc-driver` all exit 0.

**`check:hotel` exits 1 — and exits 1 identically on the unmodified base (8cae5514), same park:**
`hotel.lobby's perimeter has 32 unwalled sample(s) outside its doorways (south at -1.70 …)`.
Not this package (a wall probe; nothing here touches the hotel). The base is red on it.

## Still not done

- No browser run: ride, story and `/view` cameras and interiors are unseen.
- `check:npc-sim-lod` is in no shard yet (integrator).
- The wander driver's own dice are not covered (two runs diverge by design).
