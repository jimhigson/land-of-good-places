# HANDOFF — story time camera (`feat/story-time-camera`)

Engineer, Opus 5.5, 24 Oct 2026. Worktree `.claude/worktrees/story-camera`.

## The ask (Jim, 24 Oct 2026, verbatim)

"during story time, I'd like the camera to enter a sequence where it comes down to player-level and goes to
over the shoulder camera, with the other children listening and the reader visible - let's make this quite
small change now please"

## What is built (pushed)

- `src/world/reptileHouse/exhibitCamera.ts` — the one over-the-shoulder shot. Generalised, exhibits unchanged:
  `ShotWorld.room` (`ShotRoom`; `REPTILE_HALL`), and opt-in `ShotRules`: `mutual` (subjects hide one another,
  never themselves — `subjectOwners`, `OccluderSet.owners`), `spread` (each outer subject also seen through N of
  its own drawn points, farthest-point sampled), `contain` (the frame holds every subject box, lens test, and
  label anchors by `IsoCamera.isOnScreen`'s own focus-plane test — `containZoom`). `occludersToward` pre-culls
  to the eye→focus segment (the room's instanced books are 9291 proxies otherwise).
- `src/world/library/storyCamera.ts` — `StoryCamera`, Game-level like `bookGlance.ts` (outside the park closure).
  Wanted = inside && seated && phase 'reading' && owl perched; starts on the rising edge; `cancel()` when she
  gets up/leaves; `bubbleLeft = Infinity` while reading, so the director's natural ease home follows the story's
  end. Input view `SEATED` never cancels (seated, the stick does nothing); `riding:false` (a cushion is a seat).
  Seats (`storySeats`: chair, rug, the kids' cushions) are the director's `cast`: never occluders.
- `Game.tick`: `storyCamera.apply(camera, player, dt)` after the glance, claim folded into `focusClaim`.
- Deep link: `/library?sit=1&story=now` (`main.ts` carries `sit` raw — the entry chunk must not import
  `layout.ts`/`libraryKit`; `Game.enterLibrarySpawn` resolves it against `LIBRARY_PLAYER_SEATS`).
  `Library.requestEnter(at, sit)` seats her behind the iris via `seatOn` (the Sit chip's own path).

## Findings (measured)

- Seed 5's accepted restart is **1** (726 s to find on main's source). Locally `LGP_PARK_RESTART=1` builds it
  without re-running acceptance after closure edits (exhibitCamera.ts and Library.ts are in the closure).
- check:exhibit-camera: 339 ✓ before and after; every chosen eye identical. Its framing numbers vary ±0.2% run to
  run on the SAME code (the solve spreads over frames on a 4 ms wall-clock budget) — pre-existing, always green.
- The kids' heads are ~1.4 m tall (KID_HEIGHT 2.12, chibi). With only middle+head targets (exhibit rules) the
  solver took eyes from which **40% of the owl's drawn points were behind Juno's hair** (cushion 1). With every
  subject required whole (spread 16, mutual), **no eye in the exhibit fan (heights ≤ 5.3 m) passes** from either
  cushion. Scanning the room to see what is achievable (`.claude/scratch/proto-scan.mts`, not committed).

## Status

- [x] solver generalised, check:exhibit-camera still green
- [x] story camera + Game wiring + deep link (tsc clean)
- [ ] decide what "unoccluded" can be at player level (scan running)
- [ ] check:library clause (every cushion × 1280x800 and 390x844), proved red; check:labels / check:deep-links
- [ ] checks, PR, CI, browser look, frame sheet
