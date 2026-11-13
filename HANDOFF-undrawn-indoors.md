# HANDOFF — undrawn-indoors (120 fps plan, step 3 + the rest of step 2)

Branch `perf/undrawn-indoors` from `origin/main` (34f20970; main had not moved at 17:00). Worktree
`.claude/worktrees/undrawn-indoors`. Dev port 6011. No PR: a later stage opens it. Merge `origin/main` with
`git -c rerere.enabled=false merge origin/main` before handing over.

## What is done (pushed)
- **The park is a space.** `World.parkRoot` holds every park group but the crowd's (`npcs.group` stays in the graph: mall
  shoppers + every resident's name pill/bubble hang under it). Registered with `DrawnSpaces` as `'garden'`; its `visible`
  is written once a frame at the top of `World.update` from `spaceAt(player) === garden`. Live game: detached indoors.
- **Park updaters gated** in `World.update` on `parkDrawn`. `Fountain.wade` (her speed/mood) runs everywhere. Train +
  `carryPassengers` gated on `npcs.crowdLiveAt` (garden + castle mall).
- **Crowd**: `NpcSystem.crowdLiveAt(x,z)`; not live -> garden kids `elsewhere`; visit timers paused; frozen kids not
  committed; pets of frozen owners still; `TreeClimbing` skips held kids.
- **Hotel** `HotelInterior.update` = suite lock + `isDrawn` gate + `animate`. **Grown-up**, **Sunny's exterior**,
  **ball pit** (`settling || isDrawn`) gated.
- **`check:undrawn-still`** in shard 4 (chain-coverage ok); red proof in its header.

## Measurements (seed 5, standing still, M4 Pro, other agents loading the Mac ~8-10)
`docs/perf/undrawn-indoors/{measure,table,profile}.mjs`; alternating builds (before-A, after-A, before-B, after-B).
cpu p50 ms x1, before -> after: library 3.0,3.5 -> 1.6,1.7; reptile 3.7,3.8 -> 2.3,2.8; mall 3.6,4.0 -> 2.3,2.3; great
hall 5.7,5.4 -> 3.7,3.7; roof 3.4,3.4 -> 1.5,1.9; hotel 4.4,6.2 -> 4.4,4.9 (noisy; profile says 572 -> 425 ms/s main
thread, World.update 123 -> 29); park 3.8,4.6 -> 4.6,4.9 (noise: park profile before/after identical, 558 vs 577 ms/s,
same functions). x4: library 14.5,17.6 -> 7.1,8.0; reptile 17.8,21.5 -> 14.9,14.2; mall 17.7,18.6 -> 14.1,14.6; hall
25.9,24.0 -> 27.4*,16.7; roof 15.4,17.4 -> 13.7,8.3; hotel 20.6,25.9 -> 13.3,17.1; park 18.2,17.2 -> 22.5*,21.9
(* = my checks were running in parallel). Focused re-run of park/hotel/hall planned (`$SP/ab2.sh`).

## Proofs in a browser (scratch, headless Chrome for Testing 1234, real GPU)
- Park unseen from every room: B vs C (park groups hidden) differs only by camera-breath edge shimmer, same as A vs B;
  no park silhouette in any diff mask (`park-unseen.mjs`).
- Coming back (`come-back.mjs`, hotel, 20 s inside): before build — train ran 41 -> 110 m unseen, all 27 children moved;
  after — park detached in the lobby, train 42.29 -> 42.29 during the stay and on to 51.57 2.5 s after return, 3 of 27
  moved (the lobby's guests), worst single-frame step back 0.112 m (before 0.118), closest pair 1.57 m (before 1.74).

## Findings for others
- Detaching the park removes its 3 visible lights from the gather indoors -> a room's light state is DayNight + its own
  lights only. first-entry-warmup: compile a room against that, not against the park's lights.
- main is RED on shard 11 (check:served-cull-audit at 34f20970): hotel `hotel.disco.motes` stale bound (1 of 40) and
  sky cruiser off-screen tris 346614 > 256463. Not caused here.
- Not gated, deliberately: `CastleFire.update` (two emissive intensities a deck, pure function of the clock);
  `World.interactZones` still lists park zones indoors (the park map's taps read them).

## State
- Checks running (`$SP/runchecks.sh`, summary `$SP/checks/summary.txt`).
