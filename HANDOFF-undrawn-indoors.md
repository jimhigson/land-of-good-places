# HANDOFF — undrawn-indoors (120 fps plan, step 3 + the rest of step 2)

Branch `perf/undrawn-indoors`. Worktree `.claude/worktrees/undrawn-indoors`. Dev port 6011. No PR: a later stage opens
it. Merge `origin/main` with `git -c rerere.enabled=false merge origin/main` before handing over.
`$SP` = `/private/tmp/claude-501/-Users-jim-dev-landOfGoodPlaces/63860b08-4a9b-4597-b7cf-7b1677887a9f/scratchpad`.

## What is done (pushed)
- **The park is a space — of its own roots.** Every park group but the crowd's is registered with `DrawnSpaces` as a
  `garden` root (`World.parkRoots`), in the scene order main always had. `World.update` says once a frame
  `drawnSpaces.showSpace('garden', spaceAt(player) === garden)`; `DrawnSpaces.showSpace` hides a space whole, over its
  roots' owners' own `visible` (fireflies by day, lamp posts behind the keychain view, the ferris wheel's clouds). Live
  game: the park is out of the graph indoors. `World.parkDrawn` = the garden space shown (NOT any group's drawn-ness:
  the ferris wheel is a park updater and must run above its own clouds).
  - **Why not one `the-park` root over the groups** (the first engineer's shape, up to db4346ba): it renamed every
    garden mesh's scene path, which `check:coplanar`'s ratchet and every checked-in park's acceptance are keyed by.
    `LGP_SEEDS=5 pnpm run validate:parks -- --fresh` on e9a2e727: `seed 5 REJECTED by check:coplanar x17: NEW:
    garden|the-park/entrance/welcome-sign/<Mesh:BoxGeometry>|the-park/entrance/welcome-sign/<Mesh:PlaneGeometry>`
    (2656 s). CI's parks + coplanar workflows would have gone red on all 16 seeds. Fixed in 96cfe195.
- **Park updaters gated** in `World.update` on `parkDrawn`. `Fountain.wade` (her speed/mood) runs everywhere. Train +
  `carryPassengers` gated on `npcs.crowdLiveAt` (garden + castle mall).
- **Crowd**: `NpcSystem.crowdLiveAt(x,z)`; not live -> garden kids `elsewhere`; visit timers paused; frozen kids not
  committed; pets of frozen owners still; `TreeClimbing` skips held kids.
- **Hotel** `HotelInterior.update` = suite lock + `isDrawn` gate + `animate`. **Grown-up**, **Sunny's exterior**,
  **ball pit** (`settling || isDrawn`) gated.
- **`check:undrawn-still`** in shard 4 (chain-coverage ok). Control 4 now watches `world.parkRoots`.

## Save indoors — answered (14 Nov), not a race
- `bootstrap.ts` awaits the park file before `main.ts` loads, so `parkStamp()` is set when `continueGame` reads it:
  every probe save carried `place.park` (e.g. `4ff194ce74f0ec5f`).
- The probe's profile is made by `/spawn`, which never marks `arrivedByBus` (only `ArrivalSequence` does). A continue
  of such a save plays the cat-bus arrival (`arrivalIsDue()`), which takes her to the gate whatever `save.place` says.
  Same on both builds (`save-indoors.mjs`, READ_MS=0):
  - main 27e570b3, arrivedByBus false: `arrival: true`, at (-0.1, -9, 61.5) by the gate. Branch e9a2e727: same,
    (-0.5, -11.7, 70.5).
  - main, save marked arrived (`ARRIVED=1`, every real player's save): restored to the lobby (-600, 0, 636.2),
    out through the door to the park. Branch: identical — lobby (-600, 0, 636.2), park detached and not drawn, out
    through the door to (37.4, -2.9, -8) with the park attached and drawn. Screenshots `$SP/u2/save-*`.
- Finding for others (not fixed here, a developer-path quirk): `arrivalSpawn.ts`'s "a restored save always wins …
  `arrivedByBus` would be true on that save anyway" is false for a profile made by any deep link. Repro: fresh
  profile, `/spawn`, walk into the hotel, wait 10 s, open `/`, press "keep playing" → the bus arrival plays.

## Measurements — the A/B (14 Nov, 11:20-11:54, M4 Pro, seed 5, standing still, 1440x900 @ DPR 2)
before = main 27e570b3, after = this branch a590d977 (= 96cfe195's code). Main-thread **thread** time of the
animation frame (Chrome trace `FireAnimationFrame` `tdur`) per frame, `thread-time.mjs`, a fresh browser per sample,
before/after interleaved and the order flipped each round; min / median of n pairs; `thread-table.mjs`.
Raw samples: `docs/perf/undrawn-indoors/results/`. Load average 25-66 throughout (a VM not ours).

| scene | space | n | before min / med | after min / med | game cpu p50 (min) | tris |
|---|---|---|---|---|---|---|
| park | garden | 8 | 3.18 / 3.78 | 3.52 / 3.84 | 3.1 → 3.5 | 1.19 M → 1.20 M |
| hotel lobby | hotel.lobby | 4 | 3.48 / 3.55 | **1.74 / 1.81** | 3.5 → 1.6 | 164 k → 116 k |
| great hall | castle.hall | 4 | 4.70 / 4.83 | **2.95 / 3.08** | 4.7 → 3.0 | 1.18 M → 1.12 M |
| library | library | 3 | 2.20 / 2.25 | **1.19 / 1.26** | 2.1 → 1.0 | 489 k → 441 k |
| reptile house | reptileHouse | 3 | 2.87 / 2.90 | **1.66 / 1.67** | 2.8 → 1.4 | 488 k → 440 k |
| castle mall | castle.mall | 3 | 2.86 / 3.23 | **1.65 / 1.70** | 2.8 → 1.5 | 193 k → 132 k |
| castle roof | castle.roof | 3 | 2.41 / 2.46 | **1.24 / 1.28** | 2.3 → 1.0 | 292 k → 237 k |

- **Every room ~1-1.75 ms a frame cheaper (36-49 %)**; the park at parity (pairs within ±0.36 ms either way, as it
  must be: in the garden every gate is open).
- **Control on the instrument** (`results/tt-control.jsonl`): a 2 ms busy loop added to every animation frame of both
  builds reads 5.51-5.99 ms in the park against medians 3.78/3.84 without — +1.7 to +2.2 ms seen of 2 ms added — while
  the game's own cpu p50 (which times only `tick`) stays at 3.5-3.9: the instrument sees main-thread work, the probe
  is not fooled by a foreign callback.
- **Why a fresh browser per sample**: the first run (one browser, a context per sample, `$SP/u2/tt-focus.jsonl`)
  read the park after-build 5.25/5.66/6.12 ms in the three rounds where it followed a before-build context in the same
  browser, 4.29/3.77 when it came first, while before read 4.06-4.47 every time — gone with a browser per sample.
- Not measured here: the x4 stand-in (CDP throttling suspends the thread, so thread time cannot see it, and wall
  time was swamped by the VM). The first engineer's x4 wall-clock rows (13 Nov, load 8-10) are in this file's git
  history; the stand-in is ~4x the desktop figure.
- First engineer's wall-clock (13 Nov, load ~8-10), cpu p50 x1 before -> after: library 3.0,3.5 -> 1.6,1.7; reptile
  3.7,3.8 -> 2.3,2.8; mall 3.6,4.0 -> 2.3,2.3; great hall 5.7,5.4 -> 3.7,3.7; roof 3.4,3.4 -> 1.5,1.9; hotel 4.4,6.2 ->
  4.4,4.9; park 3.8,4.6 -> 4.6,4.9 — the same direction; this table supersedes it.

## Proofs in a browser (headless Chrome for Testing 1234, real GPU, dev servers on 6011, seed 5)
- First engineer, before the roots change: park unseen from every room (`park-unseen.mjs`, pixel diffs).
- **Coming back** (`come-back.mjs`, hotel door at (-7.28, -41.42), 20 s inside), on the roots head (f32a89bd):
  park roots in the graph in the lobby 0 of 16; train 42.97 -> 42.97 m during the stay, on to 52.34 m 2.5 s after
  she is back; 3 of 27 children moved while she was in (the lobby's guests); worst single-frame step back 0.111 m;
  24 of 27 moving within 2 s; closest pair 1.80 m before, 1.59 m back. **Main** (27e570b3), same run: train 54.64 ->
  110.56 m unseen, all 27 children moved, worst step 0.119 m, closest pair 1.60 m. The screenshots at the door are the
  same picture (`$SP/u2/comeback-{before,after}/3-park-after.png`): the difference is where the train and the
  children are elsewhere in the park — on main the park moved on while she was in; here it waited for her.
- **Ferris wheel through the clouds** (`ferris-clouds.mjs`, `/ferris`): branch — park hidden at 17.0 s (15 of 16
  roots out of the graph; the lamp posts' own per-frame `visible` write keeps them in, exactly as on main, where
  `World.update` rewrites them after the ride hides them), back at 79.2 s, ride over at 98.3 s, `parkDrawn` true
  throughout (the ride is a park updater), no page errors. Main: hidden 17.1 s, back 78.8 s, over 98.0 s.
- **Save made indoors, roots head**: saved in the lobby with the park 0/16 in the graph, "keep playing" pressed at
  once (`ARRIVED=1`) -> restored to (-600, 0, 636.2) in the lobby, 0/16; out through the door -> (74.5, -13.4, 1.7),
  15/16 in the graph (the fireflies sleep by day), park drawn.

## Findings for others
- Detaching the park removes its 3 visible lights from the gather indoors -> a room's light state is DayNight + its own
  lights only. first-entry-warmup: compile a room against that, not against the park's lights.
- Not gated, deliberately: `CastleFire.update` (two emissive intensities a deck, pure function of the clock);
  `World.interactZones` still lists park zones indoors (the park map's taps read them).

## State
- Merged origin/main 27e570b3 (#777) as e9a2e727 (BallPit.ts: kept `settling` and main's `settleNow`). Main had not
  moved at 10:00 14 Nov.
- On 96cfe195 (the roots change): `check:undrawn-still` exit 0, `--mutate` exit 1 (transcript in its header);
  `LGP_SEEDS=5 pnpm run validate:parks -- --fresh` exit 0: `seed 5 accepted in 442 s — restart 1, 134 measures,
  placement f06f4b4bedd6032e`.
- On f32a89bd: `pnpm run test:procgen` exit 0 (54 files, 2217 tests); `check:npc-presence` exit 0.
- **The full `pnpm run check` died in shard 1 at `check:crowd` -> `check:npc-perch`**: `TypeError:
  this.npcs.isHeldStill is not a function` — the check builds `TreeClimbing` over a stub crowd `{ all: [character] }`
  that the first engineer's `isHeldStill` call never reached locally (it is not on the handoff's list of checks run).
  CI's shard 1 would have gone red. Fixed in 5381bf69 (the stub answers `isHeldStill: () => false`, a living crowd);
  `DrawnSpaces.showSpace` got unit tests in `test/store/drawn-spaces.test.ts`, proved red against two breaks.
- On 5381bf69 / 6ccba45c: the rest of the chain from `check:crowd` on, each piece separately, every one exit 0
  (`check:crowd`, speech-bubbles, procgen-boundary, hot-path-churn, shards 2-12); `check:coplanar` exit 0 — "186
  same-facing coplanar seam(s) across 16 seed(s) and 10 space(s) … All of them are in the baseline; none is new."
- **Merged origin/main bb7e9c99 (#778, shadow cache measured and left off)** as fba4cec9: clean. The cache, when
  asked for (`?shadowCache=1`), walks `visible` the way three's pass does, so a park root out of the graph reads as
  "a cached caster disappeared" and redraws — right, and not exercised here (the cache is off by default).
- On the merged head fba4cec9 (code = 998ad283): tsc 0, typecheck:test 0, shards 1-12 each 0, npc-presence 0,
  undrawn-still --mutate 1 (expected), test:procgen 0 (2219 tests), build 0.
- **Merged origin/main 66bcd7f8 (#779 TypeScript 7.1 + vite 8.3.8 + rolldown, #780)** as 26b68da9: clean;
  `pnpm install --frozen-lockfile`. **On 26b68da9, each exit code read directly**: tsc (7.1.0-dev.20261006.1) 0,
  typecheck:test 0, `check:shard-1` … `check:shard-12` each 0 (the whole `check` chain, shard by shard;
  `$SP/u2/all-exits.txt`), `check:npc-presence` 0, `check:undrawn-still -- --mutate` 1 (expected, same totals as its
  header), `test:procgen` 0 (54 files, 2219 tests), `pnpm run build` 0. On the same src before the tooling merges:
  `check:coplanar` 0 (16 seeds), `LGP_SEEDS=5 validate:parks --fresh` 0. Main had not moved again at 17:13.
- Shards 5 and 6 took 27 and 71 min on that run (a VM not ours at ~980 % CPU); 6 and 8 min the run before.
- Base worktree removed. Port 6011: nothing of this item running on it. **Done; ready for a PR.**
