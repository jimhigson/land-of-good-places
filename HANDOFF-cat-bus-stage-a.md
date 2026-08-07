# HANDOFF: cat bus Stage A (`e-cat-bus-stage-a`, branch `e/cat-bus-stage-a`)

Wiring up the arrival that PR #27 shipped as dead code. Issue #245.
Predecessor investigation: `HANDOFF-cat-bus-arrival.md` on `e/cat-bus-arrival` —
**read that first**, it is the root cause and is not repeated here.

Worktree `/Users/jim/dev/landOfGoodPlaces/.claude/worktrees/e-cat-bus-stage-a`,
off `origin/main` @ `929d792`. `npm ci` done, exit 0.

## Scope

Stage A only: bus rolls to the gate, door opens, player + other children hop
off, gameplay starts at the park edge. **Stage B (the animated journey down a
lane) is specified but NOT in scope** — see "Stage B seam" below.

Jim, via the Overseer: **not skippable.** No skip button, no hold-to-skip, no
"seen it before" shortcut. Appearance is editable in-game, so a child never
restarts to change her hair — the arrival really is once per new character.

## THE DECISION THAT MATTERS — where the arrival is constructed

**`World` owns `Entrance`; `Entrance` owns the arrival. NOT `Game`.**

This is not a style preference, it is the whole guard. Measured facts:

- Tests run in **plain node** (`vitest.config.ts` sets no `environment`), no
  jsdom anywhere. `three` imports fine; `scripts/headless-canvas.mjs` stubs the
  DOM that art code paints textures into.
- **`Game` is not constructible in a test** — `src/Game.ts` imports `Engine`,
  which is a real `WebGLRenderer`. Nothing in `test/` or `scripts/` builds one.
- **`scripts/park-harness.mts`'s `buildHeadlessPark()` builds a real `Scene`
  and a real `World`**, and `test/procgen/parkFacts.ts` already does
  `scene.updateMatrixWorld(true)` + `scene.traverse(...)` over it.

So: anything hung off `World` is reachable by the invariant suite that CI
**blocks the merge** on. Anything hung off `Game` is reachable by nothing at
all — which is precisely how a whole merged feature went twelve days unseen.
Wiring this into `Game.ts` would have rebuilt the original bug's blind spot.

## Trigger — `arrivedByBus` is the mechanism, and it fails SAFE

The brief suggested triggering on the character-creation path with
`arrivedByBus` as belt-and-braces. **I inverted that, deliberately.**

`arriveByBus` defaults to `!hasArrivedBefore()`. So the arrival plays unless
something *actively opts out*. Rationale:

- "Every time a new game is started" is already exactly `arrivedByBus === false`
  — `main.ts`'s `startFresh` calls `clearSave()`, so a new game always has the
  flag false. A continued game has it true. The two never disagree except when
  she quits mid-arrival, where replaying is the *correct* answer: she never
  finished arriving.
- **Direction of failure.** If the trigger were "someone must remember to pass
  `arriveByBus: true`", then forgetting is silent and the arrival never plays —
  the exact twelve-day failure, rebuilt. With the default the safe way round,
  the dangerous mutation requires actively passing `false`.

Explicit opt-outs (`arriveByBus: false`), both correct:
- `RIDE_DEEP_LINKS` (`/rail-race` etc.) — the point is to board instantly.
- `/view` debug camera — shows the park, not a cutscene.

`markArrived()` is called when control is handed over, not before, so a quit
mid-sequence replays it.

## Staging (geometry, all from `layout.ts`, nothing hand-placed)

Gate (0, 60); bus stop (0, 52); bus parks (0, 54.6); player ends (−1.60, 51.60)
= `ENTRANCE_PLAYER_X/Z`. Bus arrives at z = 64, vanishes at z = 68.

- Bus drives in **forward**, `rotation.y = π`, so the cat face leads into the
  park — best first impression, and it means the door (local −X) opens onto
  **world +X**, which is where `Entrance.ts` already puts the shelter (+3.5)
  and says so: *"so the cat bus's curb-side door opens directly onto it"*.
- Everyone steps down onto that curb, walks forward past the bus's front, and
  turns into the park. Player is released at `ENTRANCE_PLAYER_X/Z`.
- **Why that release point matters:** `ENTRANCE_PLAYER_X/Z` is imported only by
  `check-park.mts`, `check-npc-jitter.mts` and `parkFacts.ts`, never by `src/`.
  `check:park`'s "15/15 attractions route from the entrance" has been measuring
  from a point the game never put her at. Moving `DEFAULT_SPAWN` there makes
  that check honest.

## The `ENTRANCE_CLEAR_*` trap (brief item 4) — real, confirmed

`ENTRANCE_CLEAR_X/Z/RADIUS` has **zero consumers**, so `Scenery.ts` does not in
fact keep trees and bushes off the stop, despite `layout.ts`'s comment claiming
it does. Idiomatic fix found: one `if (onEntrancePlaza(x, z, clearance)) return
false;` inside `isPlantable` (`Scenery.ts:980-993`), sibling to the existing
`onRideExit`. `isPlantable` is also called by the wall generator via
`runIsClear`, so walls are covered too. Plus an invariant in the same PR.

Watch the anti-vacuity floors when this thins the scatter: `trees > 24`,
`bushes > 107`, `climbableTrees > 24`, on all five seeds.

## Baseline to beat

`npm run test:procgen` on `origin/main`: **9 files, 200 tests, 0 skipped**.
(200 = 5 seeds x (1 + 34 invariants) = 175, plus 25 across the 4 non-seed
files.) Adding one invariant makes it 5 x 35 = 175 -> 180, i.e. 205.
**Quote the count off the screen, never the one you expected.**

## Stage B seam (do not build, do not make harder)

Stage B = straight narrow lane, camera orbiting the bus, hills and trees going
past, its own self-contained scene. It hands over to Stage A at exactly one
point: **bus at `ENTRANCE_BUS_ARRIVE_Z` (z = 64), outside the gate, player
aboard, door shut.** Stage A's first phase begins there, so Stage B attaches in
front of it with no seam. Keep that boundary a named phase.

## Status

- [x] Read brief, docs, all six `src/world/entrance/` files, boot path
- [x] Harness mapped; guard strategy decided (see above)
- [ ] Arrival sequence written
- [ ] Wired: `World` -> `Entrance` -> arrival; `DEFAULT_SPAWN` moved
- [ ] `ENTRANCE_CLEAR_*` wired into `Scenery.ts` + invariant
- [ ] Guard proved red by removing the wiring
- [ ] Browser QA on own port, screenshots
- [ ] PR raised referencing #245
