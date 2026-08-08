# HANDOFF: cat bus QA fixes (`e-cat-bus-qa-fixes`, pushes to `e/cat-bus-stage-a`)

The three things QA would not sign off on. Issue #245, PR #246.

**Read first:** `HANDOFF-cat-bus-seating.md`, `-loading.md`, `-round5.md`,
`-stage-b.md`, `-stage-a.md` in this tree. None of their findings is repeated
here. QA's 139 screenshots: `/private/tmp/qa-cat-bus-shots/`.

Worktree `/Users/jim/dev/landOfGoodPlaces/.claude/worktrees/e-cat-bus-qa-fixes`,
branch `e-cat-bus-qa-fixes-work`, off `origin/e/cat-bus-stage-a` @ `050e3cb`.
`npm ci` exit 0.

**My dev server port is 5486** (PID noted at start; killed by PID at the end).
5200 / 5210 / 5412 are other people's. Captures go to
`/private/tmp/catbus-qa-fixes/`, outside the worktree.

## Baseline, read off the recorded line before touching anything

- `npm run build` — **exit 0** (`RECORDED_BUILD_EXIT=0`, grepped from the log)
- `npm run test:procgen` — **exit 0**, `Test Files 11 passed (11)`,
  `Tests 281 passed (281)`, **0 skipped**

That is the bar. Reconciled against the seating round's stated 281/11/0.

## The capture rig, and the one thing that invalidates a run

`scratchpad/pw/lib.mjs`. Playwright at
`~/.npm/_npx/e41f203b7505f1fb/node_modules`, throwaway profile every run.

**`channel: 'chromium'` is not optional.** The default `headless: true` gives
**SwiftShader** and every timing off it is meaningless. `assertRealGpu()` reads
`WEBGL_debug_renderer_info` and throws rather than continue; a good run prints
`ANGLE (Apple, ANGLE Metal Renderer: Apple M4 Pro, ...)`.

A fresh profile lands on **character creation** — click `.charcreate-go` first.
Poll `window.journey.ride.elapsed`, never sleep. To inspect from an arbitrary
pose, set `ride.update = () => {}` and drive `ride.camera`; the loop keeps
drawing.

## Root causes, measured

### 1. The overrun freeze — three clocks, and the wrong one drives the screen

`BusJourney` has **three** clocks (`journeyDirector.ts`, `BusJourney.ts:439–455`):

| clock | stops when | drives |
|---|---|---|
| `JourneyDirector.elapsedSeconds` | never | `rideOver`, `overrunning` |
| `BusJourney.elapsedSeconds` | **clamped at 20 s, frozen while idling** | bus Z, the shot cut, the orbit camera, **and the title** |
| `BusJourney.animationSeconds` | never | children's bounce, tail, wheels |

So the two things QA saw still moving are exactly the two on `animationSeconds`,
and the three frozen ones — camera, bus, title — are exactly the three on the
**lane** clock. `main.ts:479` fed the title `journey.elapsed`, and
`JourneyTitle`'s own doc argued *for* that ("the letters stop hopping exactly
when the bus stops"). That was the decision QA overturned.

**The bus also stopped in open lane**: `busZ = -elapsed * BUS_SPEED` bottoms out
at −220 m, and `PARK_AHEAD_Z` — the gate — is at **−250**. `PARK_STANDOFF = 30`
is the gap, deliberate for the closing shot, but it means the idle happens 30 m
short of anywhere a bus would ever wait.

### 2. The cabin below the shoulder line is a **solid block**

`cat-bus-shell-lower` (`catBus.ts:492`) is a solid `RoundedBoxGeometry` the full
width and length of the cabin, from the floor to `WINDOW_SILL_Y`. The twelve
seats, the floor pan and every child's body are **inside** it. Seat backs stop
exactly at the sill, flush with the block's lid.

That — not the camera's aim — is why *"there is no seat, window, pillar or
ceiling in shot"*. Proved by hiding the mesh at runtime and re-shooting the same
pose: `/private/tmp/catbus-qa-fixes/explore-inside3/{solid,hollow}-*.png`. The
solid pair are a flat grey lid over pink seat backs; the hollow pair have seat
backs, bodies, heads and daylight.

Aiming forward alone gets QA's reference shot back (their
`r10-driver/driver-inside-behind.png` is a lens **inside** that block — its
walls are `FrontSide`, so from within they are culled and invisible).

### 3. The title's bands were never checked against the bus

`TITLE_BANDS` (`JourneyTitle.ts:85`) is `ART.rainbow[0,1,2,5]`, reasoned against
**grass and sky** only. The bus's own body is `PALETTE.pathEdge` **0xffeecb**
and its roof is `flowerYellow` lerped 35 % to white ≈ **0xffeb9b**. Every band
in `ART.rainbow` is a pastel pulled *towards cream* by design
(`artPalette.ts:214`), so on the roof the yellow band has almost no contrast at
all. On desktop the title sits above the bus and it never showed.

## Status

- [x] Own worktree, `npm ci`, baseline recorded
- [x] Read the five cat-bus handoffs, issue #245, PR #246
- [x] Capture rig on the real GPU
- [x] Root-caused all three
- [ ] Fix 1 — idle: presentation clock, bus pulls up at the gate
- [ ] Fix 2 — title colours + portrait layout + portrait FOV
- [ ] Fix 3 — hollow cabin + interior camera aimed forward
- [ ] Guards, each proved red
- [ ] build / test:procgen, captures, PR + handoff

## Do not act on these

Jim has them on a separate list: total time to controls (~30 s), the skip at
t=4.5 s, the ride being silent, riders wearing nothing, 16 characters in 4
cycled colours, the rail-race track's striped shadows on the bus.
