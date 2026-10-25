# HANDOFF — story time camera (`feat/story-time-camera`)

Engineer, Opus 5.5, 24–25 Oct 2026. Worktree `.claude/worktrees/story-camera`.

## The ask (Jim, 24 Oct 2026, verbatim)

"during story time, I'd like the camera to enter a sequence where it comes down to player-level and goes to
over the shoulder camera, with the other children listening and the reader visible - let's make this quite
small change now please"

## What is built (pushed)

- `src/world/reptileHouse/exhibitCamera.ts` — the one over-the-shoulder shot (director + solver), generalised,
  exhibits unchanged (check:exhibit-camera 339 ✓ before and after; its framing numbers vary ±0.2% run to run on
  the same code — the solve spreads over frames on a 4 ms wall-clock budget, pre-existing). New: `ShotRoom`
  (`REPTILE_HALL`), `ShotRules` {`mutual`, `spread`, `contain`, `overHerShoulder`, `ideal`}, `asWhole(objs, share)`,
  `firstBlocker` (whose mesh: subject index, −1 room, −2 her), `occludersToward` (pre-cull), confirm on a 6×
  spread, a room-only edge margin (7 cm), yields in every heavy step (`spreadTargets`, occluders, framing the fan
  every 40 eyes, 12 sightlines a step, approach every 10 samples).
- `src/world/library/storyCamera.ts` — `StoryCamera`, Game-level like `bookGlance.ts` (outside the park closure).
  Wanted = inside && seated && 'reading' && owl perched; starts on the rising edge; cancel when she gets up/leaves;
  `bubbleLeft = Infinity` while reading. Shares: owl's head 1, owl 0.75, each head 0.85, each listener 0.5; the
  room or her body on any point fails an eye. `STORY_IDEAL` = 2×KID_HEIGHT up, 1.6 m back, 50° off her back.
- `Game.tick` applies it after the glance. Deep link `/library?sit=1&story=now` (`sit` carried raw by `main.ts`
  — the entry chunk must not import `layout.ts`; `Game.enterLibrarySpawn` resolves it; `Library.requestEnter(at,
  sit)` → `seatOn` behind the iris). `Library.furniture(id)` exposes the furnished pieces (the seats).
- Checks: check:library STORY CAMERA (4 cases: cushion 1/3 × 1280×800/390×844; chip / jump / standUp / story
  ends; one sits after the reading began), mutations `no-story-camera`, `story-camera-stays`, `story-camera-low`;
  check:labels wiring + "bubble and Get up chip both drawn on every held reading frame"; check:deep-links `/library?sit=1&story=now`.

## The finding that shaped it (measured, 24–25 Oct)

The children's heads are ~1.4 m tall and ~1.5 m across with hair (KID_HEIGHT 2.12); cushions 4 and 5 sit square
in front of the story chair. Over her shoulder, the best eye sees of the owl: 51% at 2.5 m up, 57% at 3 m, 77% at
3.5 m, 88% at 4 m, 92% at 4.5 m — and her OWN head hides part of someone from almost every eye below 4 m. All
of everyone whole needs an eye 6 m up (top-down). So the shot comes down to ~4.3–4.8 m (just over the listeners'
heads), 1.6 m behind her, off her shoulder: owl 84–90% (head 100%), children 96–100%, nothing of the room or hers
in front of anyone. A layout change (cushions 4/5 apart, or the chair moved — HANDOFF-library-v2 "the cushion-1
view") would let it come lower; that is Jim's call.

## Local running

- Seed 5's accepted restart is **1**: `LGP_PARK_RESTART=1` skips the 12-minute acceptance loop locally.
- Prototypes in `.claude/scratch/` (ignored, never committed).

## Status

- [x] solver + story camera + deep link + check wiring
- [x] check:library green: exit 0, 337 ✓ (STORY CAMERA, 4 cases). Eyes (room-local): cushion 1 (2.86, 4.80 up,
  −6.59) both screens; cushion 3 (5.14, 4.80, −6.59) laptop, (7.46, 5.30, −7.63) phone.
- Reds (seed 5 restart 1; room at (−600, −600); cushion 1 room (2.1, −8), cushion 3 (5.9, −8), chair (4, −11.1)):
  - `no-story-camera`: exit 1, 331 ✓ 6 ✗ — never comes down ×4 ("6.02 s after the first page … idle"); from the
    rig, cushion 3: "Fenn 0 by the room, 1569 by her — e.g. (5.00, 0.20 up, -9.50) behind HER OWN BODY".
  - `story-camera-low` (the control: eye straight behind her at 2.5 m, room (1.05, 2.50 up, −4.50) from cushion 1):
    exit 1, 314 ✓ 23 ✗ — "the owl's head wholly seen (5% of 259 points) and 3% of her"; "the owl … 1206 by her;
    Juno … 5182 by her — e.g. (3.81, 0.36 up, -11.19) behind HER OWN BODY"; "Juno 22% (head 34%) … Fenn 15%".
  - `story-camera-stays`: exit 1, 299 ✓ 38 ✗ — but only FOUND FROM THE DESK (36) and 2 occlusion lines: the kept
    focus is where the glide home ended, on her, so STORY CAMERA's home read green while she stood still. Fixed:
    the walk clause now asks the camera to follow her (orbit ≤ 0.3 m a second after she stops). Rerunning.
- [ ] check:labels, tap-spacing, exits, jitter; full check; test:procgen
- [x] **PR #736** opened (base main). CI running.
- [ ] CI green; look on the preview (`.claude/scratch/look.mjs <preview-url> <out>`), frame sheet
