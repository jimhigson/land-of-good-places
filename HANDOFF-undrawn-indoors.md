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

## Measurements
First engineer (13 Nov, load ~8-10), cpu p50 ms x1 before -> after: library 3.0,3.5 -> 1.6,1.7; reptile 3.7,3.8 ->
2.3,2.8; mall 3.6,4.0 -> 2.3,2.3; great hall 5.7,5.4 -> 3.7,3.7; roof 3.4,3.4 -> 1.5,1.9; hotel 4.4,6.2 -> 4.4,4.9;
park 3.8,4.6 -> 4.6,4.9 (park noise; profile identical). x4 in the git history of this file.
14 Nov: **the Mac is not quiet** — a Virtualization VM (not ours) at ~860 % CPU, load 50-230, display asleep (headless
Chrome at 60 Hz, `CVDisplayLinkCreateWithCGDisplay failed`). Wall-clock pairs were garbage (hotel after 2.9 -> 15 ms
between rounds); thread time (`thread-time.mjs`, trace `tdur`) tracks wall time here (E-cores / contention), so it does
not escape the load either. Method now: interleaved pairs through one port (`$SP/u2/twin-serve.mjs`, before.localhost /
after.localhost on 6011), min and median per build (`thread-table.mjs`), load on every sample.

## Proofs in a browser (first engineer, before the roots change)
- Park unseen from every room (`park-unseen.mjs`); coming back after 20 s in the hotel plausible (`come-back.mjs`).

## Findings for others
- Detaching the park removes its 3 visible lights from the gather indoors -> a room's light state is DayNight + its own
  lights only. first-entry-warmup: compile a room against that, not against the park's lights.
- Not gated, deliberately: `CastleFire.update` (two emissive intensities a deck, pure function of the clock);
  `World.interactZones` still lists park zones indoors (the park map's taps read them).

## State
- Merged origin/main 27e570b3 (#777) as e9a2e727 (BallPit.ts: kept `settling` and main's `settleNow`). Main had not
  moved at 10:00 14 Nov.
- Running on 96cfe195: `check:undrawn-still` green + `--mutate` (`$SP/u2/undrawn-*.log`), `LGP_SEEDS=5 validate:parks
  --fresh` (`$SP/u2/validate-5-roots.log`). Then: re-prove the header transcript of check:undrawn-still, rebuild
  dist-after, A/B, the full `check` + `test:procgen` + `check:coplanar`.
- Base worktree `.claude/worktrees/undrawn-indoors-base` (detached at 27e570b3) — remove when done.
