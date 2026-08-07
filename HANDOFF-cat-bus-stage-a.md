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

## Status — Stage A complete

- [x] Read brief, docs, all six `src/world/entrance/` files, boot path
- [x] Harness mapped; guard strategy decided (see above)
- [x] `ArrivalSequence.ts` written — the timeline nobody had written
- [x] Wired: `World` -> `Entrance` -> arrival; `DEFAULT_SPAWN` moved to the gate
- [x] `ENTRANCE_CLEAR_*` wired into `Scenery.ts` + invariant
- [x] Guards proved red by mutation (five of them, below)
- [x] `npm run build` exit 0; `npm run test:procgen` 10 files / 210 tests / 0 skipped
- [ ] **Browser QA — NOT DONE, tooling unavailable. See below.**
- [x] PR raised referencing #245

## Measured results

`npm run check:cat-bus` (new, in the `build` chain):

```
handed over at -1.60, 51.60 (ENTRANCE_PLAYER_X/Z, drift 0.0000 m)
nobody walks through the parked bus — the route goes round its nose
child 0 walked 3.77 m, finishing at 0.50, 50.40
child 1 walked 6.14 m, finishing at -3.30, 50.90
bus travelled 13.40 m, z 68.0 down to 54.6
door swung to 2.05 rad while unloading, shut at both ends
339 frames riding, 217 frames walking
phases: rolling-in -> doors-opening -> kids-off -> stepping-down -> walking-in
        -> departing over 12.4 s
```

She gets the controls at **9.2 s**; the bus departs behind her over the
remaining 3.2 s.

**The investigation's own smoking gun, re-run on this build's `dist/`:**
`cat-bus` 0 -> 2, `chassis` 0 -> 1, `entrance-kid-` 0 -> 1, `arrivedByBus`
12 -> 13. The code now actually ships.

## Mutations proved red (all restored)

1. Arrival built but never added to the scene -> **5/5 seeds red**, "no node
   named `cat-bus` anywhere in the built scene".
2. `onEntrancePlaza` removed from `Scenery.ts` -> **4/5 seeds red**.
3. Door never opens -> `check:cat-bus` red.
4. Hand-over moved to the plaza -> red, "44.63 m from ENTRANCE_PLAYER_X/Z".
5. `readFlags` stops reading `arrivedByBus` -> 2 of 6 save tests red.

**Two of my own checks were vacuous first and measurement caught it** — worth
knowing, because the same trap is waiting in Stage B:

- The keep-out invariant at a bare `PLAYER_RADIUS` passed on all five seeds
  *with the keep-out removed*: the nearest bush to her spawn on the canonical
  seed is 0.94 m, clear of her 0.62 m body. Re-derived at 1.5 m (0.62 body +
  0.85 widest clump), matching `Scenery.ts`'s own ride-exit clearance.
- "Widest the door ever swung" passed on a door that never opened, because
  `depart` starts by closing it *from fully open* and so writes a swing of 1 on
  its first frame. Now scoped to the phases where somebody is getting out.

## BROWSER QA: NOT DONE — read this

**No browser tooling exists in this session.** The chrome-devtools MCP is not
present and the Claude-in-Chrome extension is not set up, so **nobody has
watched this sequence with their eyes.** Dev server was started on **5418**
(`--strictPort`) and killed by PID; ports 5200/5210/5410 untouched.

Instead there is `/private/tmp/claude-501/-Users-jim-dev-landOfGoodPlaces/`
`68ade46a-c81d-46a8-8676-003ebeeaa648/scratchpad/arrival-plan-view.svg.png` —
a plan view plotted from the 748 real traced frames. It is **not a screenshot**.
It confirms the geometry (the walk goes round the bus's nose, she lands on
`ENTRANCE_PLAYER_X/Z`) and nothing about how it *looks*.

**What still needs a human with a browser**, in priority order:

1. **Does the camera behave while she is inside the bus?** `IsoCamera` follows
   the player, and for the first ~3.8 s she is parented nowhere — posed inside
   an opaque bus. The camera should track the bus in. Untested visually.
2. **Is she visible at all during the ride?** The bus's windows use
   `PALETTE.buildingWindow` with `MeshToonMaterial` and are **opaque**, so she
   and the driver are probably not visible through them. Fine for Stage A;
   **Stage B explicitly requires seeing them through the windows**, so this is
   the first thing Stage B has to fix.
3. **Does 9.2 s before control feel long?** It reads fine on paper. A
   six-year-old is the only real judge.
4. Do the sounds fire? WebAudio needs a gesture; character creation provides
   one, but this is unverified.
5. Does the door read as opening on the shelter side, and does walking round
   the nose look deliberate rather than like a bug?

## Two things verified by reading, worth not re-deriving

- **"Start again" does not carry a stale flag.** `saveFlags.hydrate` is called
  in exactly one place (`main.ts:224`, inside `continueGame`). The
  `onStartAgain` path never hydrates, so `saveFlags` stays at its module
  defaults and `arrivedByBus` is false — a brand-new character always gets the
  arrival, a continued save never does. Both directions correct on the real
  boot path.
- **Quitting mid-arrival replays it**, correctly: `markArrived()` only fires at
  hand-over. The autosave may record her position inside the bus, but the
  arrival overrides the restored spawn on the next boot.

## Known caveat, deliberately not fixed in Stage A

**The bus has no collision.** For the 3.2 s of `departing` she has the controls
while a solid-looking bus is still there and walk-through-able. `CollisionWorld`
is built once from static circles and has no removal, so a moving collider is
not a small change. Low risk — she is handed control beside a bus that is
already leaving, so she has to chase it — but it is real, and a child might.
Worth doing properly if Stage B gives the bus a longer on-screen life.
