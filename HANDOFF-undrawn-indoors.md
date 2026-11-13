# HANDOFF — undrawn-indoors (120 fps plan, step 3 + the rest of step 2)

Branch `perf/undrawn-indoors` from `origin/main` (34f20970). Worktree `.claude/worktrees/undrawn-indoors`. Dev port 6011.
No PR: a later stage opens it. Merge `origin/main` with `git -c rerere.enabled=false merge origin/main` before handing over.

## What is done (pushed)
- **The park is a space.** `World.parkRoot` holds every park group but the crowd's (`npcs.group` stays in the graph: mall
  shoppers + every resident's name pill/bubble hang under it). Registered with `DrawnSpaces` as `'garden'`; its `visible`
  is written once a frame at the top of `World.update` from `spaceAt(player) === garden`. Live game: detached indoors.
- **Park updaters gated** in `World.update` on `parkDrawn` (fountain visuals, fairy/lamp/tree lights, fireflies, anchor
  plots, coaster, rail race, ferris wheel, entrance, stalls, face paint, keychain, flowers, dodgems). `Fountain.wade` (her
  speed/mood) runs everywhere. Train + `carryPassengers` gated on `npcs.crowdLiveAt` (garden + castle mall).
- **Crowd**: `NpcSystem.crowdLiveAt(x,z)` = her space is in `crowdSpaces` (garden + every attraction's space = mall).
  Not live -> garden kids marked `elsewhere` too; visit timers paused (no pile at the castle door); frozen kids not
  committed (was re-packing the crowd every frame); pets of frozen owners still; `TreeClimbing` skips held kids.
- **Hotel**: `HotelInterior.update` = suite lock + `if (!isDrawn(hotelRoot)) return; animate(context)`.
- **Castle grown-up** gated on `isDrawn(grownUp.root)`; **Sunny's exterior** gated on `isDrawn(exterior.root)`.
- **`check:undrawn-still`** (was `owed:`), shard 4, chain-coverage ok. Garden + 6 rooms + 4 controls; red proof and
  green output in its header (ce7f6f3d). Runs in 16 s.

## Measured before (main 34f20970 build, seed 5, standing still, M4 Pro, load ~8 from other agents)
cpu p50/p99 ms, x1: park 3.8/4.6, hotel lobby 4.4/5.2, library 3.0/3.7, reptile 3.7/4.7 (dpr 1.25!), castle mall
3.6/4.3 (dpr 1.5), great hall 5.7/6.9, roof 3.4/4.1. x4: park 18.2/23.0, hotel 20.6/24.3, library 14.5/17.7, reptile
17.8/21.5, mall 17.7/21.7, hall 25.9/31.6, roof 15.4/20.2.
In-place experiment, hotel lobby x1: as shipped 4.5-5.1, park detached 3.5-3.7, + park updaters off 2.8-2.9.

## Findings
- Detaching the park removes its 3 visible lights from the gather indoors -> interior programs compile without park
  lights (7 new programs in the experiment when toggled live). First entry compiled anyway before (warm-up compiles
  detached roots against park lights only, never with the room's own lights). Tell first-entry-warmup: a room's real light
  state is now DayNight + the room's own lights, no park lights.
- main is RED on shard 11 (check:served-cull-audit at 34f20970): hotel `hotel.disco.motes` stale bound (1 of 40) and
  sky cruiser off-screen tris 346614 > 256463. Not caused here; noted.

## Next
- A/B measurement running (`$SP/ab.sh`, results `$SP/ab-x1.jsonl`, `$SP/ab-x4.jsonl`).
- Run affected checks: hotel, library, reptile-house, castle, npc-sim-lod, jitter, park, render-budget (served), labels.
- Browser look: leave each room -> park resumes, nothing pops. Screenshots.
