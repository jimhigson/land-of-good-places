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

## Determinism (25 Oct)

Two runs of one scene once chose two eyes: the solve spreads over frames on a 4 ms wall-clock budget while the
listeners sway. Fixed (f859e2b5): the solve's first step reads the whole scene — both occluder sets held where
they are (`collectOccluders` copies each mesh's matrix) and every whole subject's meshes frozen (`freeze`); the
spread is then sampled from the frozen copies across frames. The prototype run twice: the same eye in all four
cases (cushion 1 (2.86, 5.30, −6.59), cushion 3 (5.14, 5.30, −6.59), room-local), the same visibility to the point.
The hand's-breadth edge is kept clear of her body as well as the room (her shoulder brushed Fenn's outline by 6
points from a 4.3 m eye) — so the shot sits at 5.3 m, 1.6 m behind her, pitch ~54°.

## Framing (26 Oct, f6749f3d)

The f859e2b5 preview, phone held upright: lens 135° tall, the owl a few pixels across. The exhibit's own framing
is sized from its animals' box seen from above, and containment was asked of axis-aligned boxes round turned
children (half again as wide as they are). Now with `ShotRules.contain` the zoom IS the containment fit, measured
on each whole subject's spread (its drawn extremities), `STORY_FRAME_MARGIN` 0.2 (room for the bubble over its
anchor). Prototype: laptop lens 62–66° (zoom 2.3–2.5), phone ~100° tall (zoom 2.0); subjects reach 80% of the
frame; visibility unchanged. Exhibits unaffected (no `contain`, so `zoomFrom` returns their framing as before).

## Local running

- Seed 5's accepted restart is **1**: `LGP_PARK_RESTART=1` skips the 12-minute acceptance loop locally.
- Prototypes in `.claude/scratch/` (ignored, never committed).

## Real browser (26 Oct, dev server, seed 5, a profile with no save)

- A profile with no save wears the default character's 1 m party hat (`defaultCharacterChoice`), 2.98 m to its
  top. Bare-headed, check:library chose different eyes from cushion 3 than the game. Now its STORY CAMERA clause
  dresses her the same way (catalogue model on `hatAnchor`, `player.wornHat` stub for `topHeight`; store untouched).
- Solve time was up to 4.4 s of the story (phone, cushion 3: the 113th candidate). Fixed by `firstFrom` in
  `exhibitCamera.ts`: a candidate asks first whatever turned the last down; same eye, 1251 → 357 steps, 1.1 s.
  Probe: `.claude/scratch/probe-solve.mjs <base> <sit> <w> <h> "&seed=5" [hat]` (dev server only, `window.game`).
- Hats, phone, cushion 3: party/flower 1.1 s; bobble/crown/snake 1.9–2.3 s; cap/ripika/puff 2.7–3.1 s; **sun: no
  shot** (cushion 1 finds one). On a phone her name label can be cut by the left edge. Both reported, not fixed.
- Exhibits vs main's own CI (ee1ad33a): settled eyes within 2.5 cm except skink 0.34 m, lagoon 9 cm (all pass).
- Dev park reuse after a camera-only edit: copy `.parks/dev/<old16>/5` to `.parks/dev/<new16>/5` (the park does
  not depend on the camera; saves a 15-minute rebuild). Never for CI.

## Status

- [x] solver + story camera + deep link + check wiring; framing (f6749f3d); solve order (873e1606); hat (c9883778)
- [x] at c9883778, exit codes: tsc 0, typecheck:test 0, exhibit-camera 0 (339 ✓), library 0 (337 ✓),
  labels 0 at 390×844 (1211 held frames) and 1280×800 (1213); reds: low 1 (314/23), none 1 (331/6), stays 1 (296/41).
  Eyes (room-local): cushion 1 (2.86, 5.30, −6.59); cushion 3 (5.14, 5.30, −6.59), phone (4.80, 4.30, −6.84).
- [ ] full `pnpm run check` (running), then `pnpm run test:procgen`
- [x] **PR #736**; body updated (`.claude/scratch/pr-body-2.md` is its source).
- [ ] CI green; look on the newest preview (`node .claude/scratch/look.mjs <preview-url> <out>` — cushion 1 gets up
  mid-reading, cushion 3 stays to the end); one frame sheet (`node .claude/scratch/sheet.mjs <spec.json> <out.png>`),
  frames to the `qa-screenshots` branch under `pr736/` (plumbing with a temporary index; no checkout).
