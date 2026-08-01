# HANDOFF — rail-race-reform (branch `rail-race-reform`)

Worktree: `/Users/jim/dev/landOfGoodPlaces/.claude/worktrees/rail-race-reform`
(NOT the shared checkout.)

**Status: PR #140 open, review round 1 addressed, not merged.** Build exit 0,
procgen 50/50 on 5 seeds. No live browser QA — see "What I could not verify".

## The brief, verbatim from Jim

> Rail race game reformed. It should now be a side-on perspective like before,
> with 4 parallel tracks. The tracks should go around the perimeter of the park,
> so that the side-on perspective is looking into the park. It shouldn't
> otherwise turn left or right but should undulate up and down with each of the
> four tracks going up and down independently. There should be obstacles to duck
> under by releasing the press, and also black parts of the track where you need
> to let go otherwise the tracks start to spark. The track rendering to 3d
> objects should use our standard track path following. The ride is a 4-way race.

## What was built

`src/world/railRace/`, a new in-park ride, replacing `Coaster`'s `race: true`
mode entirely.

| file | owns |
| --- | --- |
| `route.ts` | the ring: 4 lanes, where they are, how they undulate |
| `plan.ts` | `RAIL_RACE_PLAN` — solved at module load, gives `paths.ts` the exit |
| `hazards.ts` | duck bars and spark zones, as data |
| `simulate.ts` | the physics and who wins. Pure — the build races it |
| `track.ts` | geometry: rails, trestles, bars, black plates, arch |
| `camera.ts` | the side-on rig |
| `sparks.ts` | pooled, allocation-free sparks |
| `RailRace.ts` | the ride: carts, riders, boarding, countdown, finish |

Plus `src/world/rail/sweptRail.ts` — the shared rail sweeper, lifted out of
`Coaster.buildTrack` and **used by both** the Sky Cruiser and the Rail Race.

## Findings a replacement should not have to rediscover

### 1. Which implementation was live (the "two competing implementations")

`Coaster.ts` with `options.race` **was** live: `MiniGameHost.checkStalls` offers
every stall to `boardRide` *before* `begin(stall)`, and `Game.ts` routed
`railRacer` → `raceCoaster.requestBoard()`, which returns true.

`src/minigames/railRacer/` was **dead code** — reachable only via the stall's
`create`, which never ran. It was, however, exactly what "like before" meant
(four lanes, three rivals, side-on, hold/release, amber→mint lamps), so its
*design* is what this reform rebuilt on real rails. It is now deleted; only
`confetti.ts` survives, because `WaterFight` and the new race both use it.

### 2. Four concentric circles are four different circumferences

311 m on the inside lane against 361 m on the outside — a sixth further to go
for the lane you happened to draw. The course is therefore parameterised by
**one shared arc length `s` on a nominal circle**, and each lane maps that same
`s` onto its own radius. The outer cart really is moving faster through the
world; nobody notices, and hazards at one `s` are fair in all four lanes.

### 3. A different phase per harmonic is a different waveform

The first version gave each lane a free phase offset per harmonic. That is not a
rotation — it changes the shape, and with it the total climb. **Measured at
2.54 m of climb between the easiest and hardest lane**, by the checker, on the
first run. Each lane is now the *same* profile **rigidly rotated** (one shift
applied to the angle), over a **level** base. Climb spread is now 0.0000 m and
gradient spread 0.00000.

If you touch the hill profile, keep both properties or the race stops being one.

### 4. The loop runs clockwise, and that sign is load-bearing

The camera outside the ring looking in fixes screen-right as
`(sin θ, 0, −cos θ)`. Running anticlockwise carries every rider **right to
left**, backwards to every side-scroller and to the direction she reads.
`RailRaceRoute.angleAt` returns `−distance / NOMINAL_RADIUS` for that reason;
`tangentAt`, `slopeAt` and `startDistance` all carry the matching sign.

### 5. The camera is deliberately not a `RideCamera`, and has no `eyeMount`

`core/RideCamera.ts` is *first-person look-around on a moving mount* and opens
with "never write a second look-around". This is not one — no look control at
all — and GAME_DESIGN's CONTROL rule keeps rotation controls to first person.

The `eyeMount` trap (models face +Z, a three.js camera looks down its own −Z, so
an unrotated eye in a seat faces the way you have just come) **cannot arise
here**: there is no mount and no seat transform, just a world position and a
`lookAt`. Verified anyway rather than argued — see below.

### 6a. Two things review caught, and what they were (1 August)

**The duck-bar guard did not guard anything.** Comparing "never lets go" against
"plays well" is not a test of the bars: a rider who never lets go also powers
over every black stretch, so the entire margin can be spark drag while a bonk
costs nothing at all. Reconstructing the original bug still passed. `bonks > 0`
proves only that bars are *encountered*.

Fixed with a `barsOnly` strategy — plays the black stretches perfectly, the bars
not at all — so against `perfect` the spark drag cancels and what is left is the
duck bars' own contribution. Then **mutation-tested**, which is the only way to
trust a regression guard:

```
fix in place                           bars worth  15.6 s   exit 0
thrust un-gated during the wobble       bars worth   7.8 s   exit 1
a bonk costs no speed                   bars worth   7.3 s   exit 1
both, i.e. the original Coaster bug     bars worth  -0.2 s   exit 1
```

**`sweptRail.ts` was a second copy, not an extraction.** `Coaster.buildTrack`
still had its own sweep and the two had already diverged: `Coaster` called 0.55
a `railGauge` and applied it as a *half*-offset, while the helper takes `gauge`
to mean centre-to-centre. Genuinely migrated now — `Coaster` has no curve or
tube code left. Reconciled by naming the interface `pointAt`/`tangentAt` after
the routes' own methods, so `CoasterRoute` **is** a `RailSampler` with no
adapter.

That uncovered a real fault: at the old 1.4 m sampling the cruiser's rails
strayed up to **224 mm** from the solved track in tight bends — three times the
rail's radius, so the rail visibly left its ties. Now 0.45 m sampling, 20 mm.
**The Sky Cruiser's rails move slightly as a result** — towards the track they
were always meant to follow. Worth a glance during QA.

`train/track.ts` is still a third sweeper, deliberately untouched: its rails are
draped on `terrainHeight` rather than carried by the route, a different
operation, and migrating it would change how the train looks.

### 6b. Root cause of "duck bars invisible/ineffective — holding wins"

Two independent faults in `Coaster.updateRace`, both designed out:

- **The bonk cost nothing.** `bonkWobble` was set but **never gated thrust** —
  it shook the seat and that was all — and the speed lerp back to full pace had
  a ~0.31 s time constant. The retired 2D game had tuned exactly this against a
  simulation ("a bonk must cost more than the coasting it saved") and the in-park
  port lost it. `simulate.ts` gates thrust while `wobble > WOBBLE_LOCKOUT`.
- **The hit window was frame-rate dependent.** `gap < 0.9` is a 1.8 m window; at
  13.5 m/s a 30 fps frame steps 0.45 m across it and a hitch steps clean over.
  Hazards are now a single ascending list of **travelled** distances walked by
  one cursor per rider, so a crossing is an interval test that cannot be
  stepped over at any frame rate, and there is no wrap arithmetic anywhere.

### 7. `test/procgen/invariants.ts` must not import the ride's modules

A static `import` of `railRace/plan.ts` pulls in `parkManifest` at module load,
which reads `LGP_SEED` **once** — before the harness has set it. Four of the
five seed suites silently built the canonical park and the guard in
`parkFacts.ts` caught it. The invariant reaches the route through
`facts.world.railRace` instead; `RailRace` exposes `route` and `laneCount` for
exactly that.

## Verification

`npm run check:rail-race` (wired into `npm run build`) measures the built
thing, not the rules:

```
lane 0..3   climb 12.57 m each, steepest 13.1° each
fairness    climb spread 0.0000 m, gradient spread 0.00000
ground      lowest rail 7.28 m over the ground it crosses
railway     7.26 m of air over the rail head (Decision 4 wants 5.5)
gate        7.42 m of air over the entrance corridor
camera      |dot(forward, travel)| = 0.0000   (perfectly side-on)
            dot(forward, inward)  = 1.0000   (straight into the park)
            dot(screenRight, travel) = 0.964 (left to right)
            tilt 20.1°, fov 40.0° at 16:9, 98.0° in portrait
never lets go  74.2 s  10 bonks  15.6 s sparking
never holds   197.8 s
sloppy         62.7 s   6 bonks
ducks nothing  67.7 s  10 bonks   0.00 s sparking
plays well     52.1 s   0 bonks
duck bars are worth 15.6 s on their own
```

The guard against the old bug is the **isolated** one: `barsOnly` vs `perfect`
differ only in whether the bars are ducked, so spark drag cancels and the
remainder is what a bonk costs. Must exceed 8 s or the build fails; it is 15.6 s,
and it has been watched to fail (see 6a).

- `npm run build` — **exit 0** (checked as the exit code, not through a pipe).
- `npm run test:procgen` — **50/50 across 5 seeds**, exit 0.
- `check:park` — 15/15 attractions route, 0 rail crossings, 71/71 waypoints.
  `rail.exclusion` ratchet tightened 21 → 20.

## What I could not verify

- **No live browser QA.** I did not own the chrome-devtools MCP and did not ask
  for it. Everything visual is inferred from geometry that was measured
  headlessly. Worth a human's eyes on, in rough priority order:
  1. Does the side-on view actually read? Lane separation at 2.6 m with 20° of
     tilt is the number I would expect to want tuning first.
  2. Are the four rails legible against a busy park backdrop, or does the park
     behind them make a mess of the picture?
  3. Do the black plates read as "let go" before a child hits one?
  4. The trestles are skipped wherever the ground is not clear; is the run of
     unsupported track over the railway too long to look right?
  5. **The Sky Cruiser**, which this PR now also touches: its rails were
     resampled 1.4 m -> 0.45 m and shift by up to ~0.2 m in the tightest bends,
     onto the solved track rather than away from it.
- **`npm run sweep:seeds`** not run (only the 5 procgen seeds).
- `vitest` was not installed anywhere on this machine; I ran `npm install`
  **inside the worktree only**, never in the shared checkout.

## Judgement calls Jim may want to overrule

- **2 laps** (~52 s played well, ~75 s not). One lap would be ~26 s.
- **Elevated at 9.5 m.** Forced by the ground being full, but it is also what
  makes the camera able to see over the wall into the park.
- **The booth stays where it is**, inland; she is carried to the rim by the iris
  wipe, exactly as the other rides carry her to stations she is not stood on.
- **The player rides the outermost lane**, nearest the camera.
- **Sparks cost drag, never a bonk.** Holding through a black stretch is slower,
  not punished.
