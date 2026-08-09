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
- [x] Fix 1 — idle: presentation clock, bus pulls up at the gate
- [x] Fix 2 — title colours + portrait layout + portrait FOV
- [~] Fix 3 — hollow cabin + interior camera aimed forward — **landscape only**
- [x] Guards, each proved red (six mutations, below)
- [x] build / test:procgen, captures, PR + handoff

---

# Round 2 — `e-cat-bus-finish` picked this up at `57ddade`

Worktree `/Users/jim/dev/landOfGoodPlaces/.claude/worktrees/catbus-finish`,
branch `e-cat-bus-finish-work`, off `57ddade`. `npm ci` exit 0. **Dev server
5433** (`--strictPort`), killed by PID. Captures in `/private/tmp/catbus-finish/`.

- `npm run build` — **exit 0**, read from a recorded file, never piped
- `npm run test:procgen` — **exit 0**, `Test Files 11 passed (11)`,
  `Tests 281 passed (281)`, no skipped line. Bar met.

## The two unfinished guards passed, and passed for the wrong reason

They were green on first run. They were also **incapable of failing on the
state QA actually photographed**, which is the disease this repo's CLAUDE.md
opens with.

Run against the running game under QA's own reproduction — `Emulation.
setCPUThrottlingRate`, real ANGLE Metal on an M4 Pro — the wait is **two
different things**, and only the first was ever measured:

| the wait | frames | camera poses | bus positions | title layouts |
|---|---|---|---|---|
| pulling in (4.0 s) | 301 | 301 | 301 | 301 |
| stopped at the gate (1.7 s) | 131 | **1** | 65 | 131 |

The pull-in is a camera following a bus that is still rolling, so it moves
whatever else is broken. The guard's window was 8 s — two thirds manoeuvre —
so the totals could never see the stopped bus. **One camera pose is the
number QA reported as a crash.** It was still reachable, just later than
anybody had looked.

Fixed in `d66fdbb`: the wait runs `3 * PULL_IN_SECONDS` and the two halves are
asserted **separately**, at a tenth of each half's own frames. Plus
`IDLE_BREATH` — the camera dollies while the bus is stopped, ramped in by the
same `atRest` the springs use, so it is identically zero on an on-time ride.
**A dolly, not a drift**: it leaves the bearing untouched, and the hand-over
cuts from that pose the instant generation finishes, which is any frame of the
wait. That property is its own guard now — 0.000 degrees of drift.

Settled half after the fix: **425 camera poses over 483 frames**.

## Measure the sampler before believing it

My first capture reported the idle as 1 camera pose over 10.2 s and I nearly
filed it as a frozen screen. It was **346 frames of stale reads**: `main.ts`
calls `journey.dispose()` and `loop.stop()` at hand-over, and a rAF sampler
keeps running over the park afterwards, reading a dead `BusJourney` whose
fields cannot change. The tell is `animationTime` — the last frame it advanced
is the last frame there was a ride. `pw/overrun.mjs` slices on that now.

## Proved red — six mutations, each restored

| mutation | result |
|---|---|
| no pull-in (bus stops where the road ran out) | nose **22.1 m** from the gate, moved 0.00 m |
| title fed the lane clock again (the shipped bug) | **1** title layout in each half |
| `IDLE_BREATH = 0` | **1** camera pose over 483 settled frames |
| bus does not rock | **1** bus position over 483 settled frames |
| idle orbits instead of dollying | camera **34.5 degrees** off the bearing |
| lane clock runs on while waiting | ran on 20.00 → 32.05 s |

## Blocker 3 is fixed in landscape and NOT in portrait

Landscape is genuinely fixed — seat 49.6%, child 33.5%, floor 10.1%, and it
reads as the inside of a bus.

**Portrait is QA's original complaint, verbatim, still there.** Measured by
casting a 48x28 grid of rays through the real frame (probe saved at
`scratchpad/pw/inside-composition-probe.mts`):

| | floor, whole frame | floor, bottom third | largest single mesh |
|---|---|---|---|
| desktop 1440x900 | 10.1% | 27.8% | `cat-bus-backrest` 37.4% |
| phone 390x844 | **33.6%** | **90.7%** | `cat-bus-floor-pan` **33.6%** |

QA's words were *"the bottom 35–40% is featureless cream floor"*. Also **0%
glazing and 0% pillar in frame at either aspect** — two of the four things
they named are still absent.

Cause: `fitCameraToViewport` widens the **vertical** fov for a tall frame (52
degrees on desktop, **83.9** on a phone), which is right for the outside shot
of a wide bus and wrong here — half those extra 32 degrees point down, at the
aisle a metre in front of the lens. It survived because **the guard sets
`aspect = 16/10` and stops**: nothing has ever measured this shot at a phone's
aspect.

**Tried and deliberately reverted.** Tilting the aim up by a share of the
widening moves the problem rather than solving it:

| share tilted up | floor | ceiling | largest single mesh |
|---|---|---|---|
| 0 (shipped) | 33.6% | 23.5% | floor pan **33.6%** |
| 0.20 | 25.9% | 29.1% | upper shell 29.1% |
| 0.50 | 15.2% | 37.4% | upper shell **37.4%** |

Giving it all to the ceiling swaps a frame owned by a featureless floor for one
owned by a featureless roof — the same complaint upside down. 0.20 lands at
29.1% against a 30% threshold, which is tuning a number until it squeaks under
a bar, and the bottom third is *still* 75% floor, so it would not clear QA
either. Reverted rather than shipped: the real answer is design work on what
the cabin has above and below the seat backs, and it wants an eye on it.

**No portrait assertion was added**, on purpose — it would be red, and whether
that blocks this PR is the Overseer's call, not a thing to decide by breaking
the build at 6 a.m.

## Do not act on these

Jim has them on a separate list: total time to controls (~30 s), the skip at
t=4.5 s, the ride being silent, riders wearing nothing, 16 characters in 4
cycled colours, the rail-race track's striped shadows on the bus.
