# HANDOFF — the cone in the road (e-lane-cone)

Branch `e-lane-cone-work`, worktree `.claude/worktrees/e-lane-cone`, from `origin/main` @ `16afbca`.
Dev server **5433** (`--strictPort`), PID in `scratchpad/dev5433.pid`. 5200/5210/5412 untouched.

Jim, on the deployed game: *"the cat bus never reached its destination due to there
being a cone shaped object in the middle of the road"*.

## The object, named

**`journey-park-rooftops`** — `BusJourney.ts:1305`, `new ConeGeometry(1, 1, 7)`, material
`PALETTE.markerPink`. It is a *rooftop silhouette*, part of the "park at the end of the
lane" prop, and it is standing **in the carriageway, in the gate opening**.

Not the park's pine (`Scenery.ts`), not the lane's own trees or hedge. Those are all
placed off the tarmac deliberately (`ROAD_HALF_WIDTH + 2.6`, `ROAD_HALF_WIDTH + 0.9`).
`buildParkAhead` is the one scatter that never asks.

```
BusJourney.ts:1313   const x = (rng() - 0.5) * 120;          // -60 .. +60, nothing excluded
BusJourney.ts:1314   const z = gateZ - 6 - rng() * 55;
BusJourney.ts:1324   const treeX = (rng() - 0.5) * 130;       // -65 .. +65, same
BusJourney.ts:1325   const treeZ = gateZ - 4 - rng() * 60;
```

`ROAD_HALF_WIDTH` is **3.89 m** and `journey-road` spans **z -320 .. +120** — the road
runs 70 m *past* the gate (gate at z = -250). So the scatter's whole z-range sits on top
of the road it is scattered around.

### Measured off the built scene (`scripts/probe-lane-cone.mts`)

Worst offenders inside the corridor `|x| <= ROAD_HALF_WIDTH`:

| object | # | x | z | half-width | intrudes | height |
|---|---|---|---|---|---|---|
| `journey-park-trees` | 42 | -0.48 | -268.9 | 4.99 | 8.39 m | 10.5 |
| `journey-park-rooftops` | 13 | -1.50 | -299.8 | 5.39 | 7.77 m | 8.6 |
| `journey-park-rooftops` | 48 | -0.74 | -272.5 | 4.59 | 7.75 m | 10.0 |
| `journey-park-rooftops` | 38 | -1.46 | -258.7 | 4.82 | 7.24 m | 6.0 |
| `journey-park-trees` | 40 | -2.75 | -304.6 | 5.77 | 6.91 m | 10.2 |

**#38 is the one Jim saw**: 6 m tall, 8.7 m past the gate, 38.7 m ahead of where the ride
stops the bus, spanning x -6.3 .. +3.4 — it covers the whole 7.8 m carriageway and fills
the arch.

**The seed is fixed** — `createRandom(20260808)`, `BusJourney.ts:1303`. Not park-seed
dependent. **Identical on every seed, every run, dev and production.** This is why it
reproduces everywhere and why "which seeds?" has the answer "all of them".

Screenshots: `scratchpad/shots/cone-from-ride-end.png` (the money shot — cone filling the
arch), `cone-approach.png` (cone on the road's vanishing point from 70 m back).

## Why the bus stops — it does not, and nothing collides

There is **no collision anywhere on the journey**. The bus's z is pure arithmetic off the
ride clock (`BusJourney.place(z)`, `busZ = -elapsed * BUS_SPEED`). A cone cannot halt it
and did not.

What actually happens is that the ride **ends 30 m short of the gate by design** —
`RIDE_END_Z = -220`, `JOURNEY_GATE_Z = -250`, `PARK_STANDOFF = 30` — and the cone stands
in the road **between the stopped bus and the arch**. So the bus visibly stops, short of
the park, with a cone in the road ahead of it. The player's reading is the obvious one and
it is the only reading available on screen.

Confirmed by watching a whole boot (`scratchpad/pw/ride-watch.mjs`): hand-over at ride
elapsed **20.0 s**, `parkReady` true, `warmReady` true, `warmRemaining` 0. Nothing hung.

### The real hazard, which is next door to this

`main.ts:526` — `void loadGame().then(...)` with **no `.catch`**. If that import rejects or
`new GameClass(...)` throws:

- `noteParkReady()` never runs -> `skipOffered` is false -> **the skip is never shown**
- `shouldBuildPark()` is false forever after (`parkStartedOnFrame >= 0`), so it never retries
- `generation.failed` is null (generation *succeeded*), so `showBootFailure` never fires
- `overrunning` stays true -> the bus idles at the gate for ever

That is a permanent hang with no escape, and it is the only path by which a first-run
player can be genuinely stuck. Not what Jim hit, but it is the shape of tomorrow's bug.

## Is a new player stuck?

**No.** The skip (`Go to the park! →`) is on screen from ~2 s and the ride hands over on
its own at 20 s. Measured, both. Urgent as a first-impression defect; not a blocker.

## The gap in the guards

`check:bus-journey` (~68 probes) and `check:park-boot` (~27) both pass on this because:

1. **Nothing measures the carriageway.** Neither imports `ROAD_HALF_WIDTH`. The only road
   invariant, `theRoadArrivesAtTheParkAndGoesIn`, is the *in-park* `Entrance` road.
2. **Nothing runs the sequence to its end.** Both construct a bare `JourneyDirector`,
   hand-call `noteParkReady()` and `noteWarmupReady()`, and assert `readyToHandOver`
   flips true. That proves the director's boolean algebra. It does not prove the real
   signals ever arrive, and the director is never joined to a `BusJourney`, a `World` or
   a `Player` in either file. `JourneyDirector` has no `finish()` — hand-over is wired
   only in `main.ts`, which no check reaches.
3. **The overrun is simulated twice, in two disjoint halves, and neither ends.**
   check-bus-journey drives a real `BusJourney` with `update(STEP, false)` and asserts the
   bus pulls in and stays alive — then calls `dispose()`. It never feeds a park-ready
   signal and never asserts the sequence terminates.
4. `ArrivalSequence` is imported by neither.

One sentence: **a dozen checks confirmed properties of the sequence; none confirmed the
sequence did its job.**

## The guard that could not fail, and how it was found

The first draft of the carriageway measurement walked each node's ancestry
looking for `cat-bus` **or `cat-bus-journey`** and exempted it. `cat-bus-journey`
is `BusJourney`'s name for the **whole scene** (`BusJourney.ts:716`), so every
node's ancestry reached it and everything was let through: **zero fouls on a
lane with a six-metre cone standing in it.** It reported green against `main`
with the fix reverted, which is the only reason it was caught. CLAUDE.md's
"break it and watch it go red before you trust it green" earned its place again.

## Status

- [x] Reproduced, object identified and measured
- [x] Screenshots of the cone (dev and production build)
- [x] Fix the scatter — placed by its own width, not rejection-sampled
- [x] Guard: `nothing stands in the journey lane carriageway` — **red on main**,
      `1 failed | 56 passed (57)`, naming four intruders with their metres
- [x] Guard: `the arrival reaches its end and hands over` — green on main
      (correctly: the sequence *does* complete), proven capable of failing by
      breaking `ShaderWarmup.ready` and watching both runs go red with
      `warmupReady=false` in the message
- [x] Two more offenders the guard found on its own, both fixed: the roadside
      hedge (0.65 m onto the tarmac) and the lane trees' canopies (0.17 m over
      the road at 5.4 m, where the bus's roof goes)
- [ ] Full five-seed `test:procgen`
- [ ] Full `npm run build`
- [ ] PR

## The honest correction on "the bus does not arrive"

It does. Measured twice — dev and a `vite preview` production build — hand-over
at ride-elapsed 20.0 s with `parkReady`, `warmReady` true and `warmRemaining` 0.
What failed was what the player *saw*. So the guard that goes red on today's
`main` is the carriageway one; the completion guard is green on `main` and is a
regression guard, not a reproduction. Both are worth having and both are here.

## Left deliberately alone

The gate's crossbar is a half-`TorusGeometry` with `rotation.z = Math.PI`, which
points the arc **downward** — its lowest vertices sit 0.86 m *below* the road at
x = 0, and only its ends show above ground as two brackets. `Entrance.ts:125-128`
does exactly the same thing, so the two gates agree and this is not a drift bug;
it is either intentional or a shared one. Out of scope here. The carriageway
invariant exempts `journey-park-gate` for this reason and says why: a gate is a
thing the road goes through, and `theGateIsAHoleInTheWall` already owns whether
its opening is passable.

`scripts/probe-lane-cone.mts` is a throwaway kept on the branch because it
prints the whole intrusion table in one line of output; the shipped guard is the
invariant. Delete it if it is not earning its keep.
