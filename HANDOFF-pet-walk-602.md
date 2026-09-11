# HANDOFF — pets route instead of warping through walls (#602, #605)

**Read this cold. None of the conversation that produced it survives.**

- **Model**: Opus 5 (1M context). Chosen by the Overseer when it dispatched
  #602. A replacement must run the **same model** (CLAUDE.md's hard rule).
- **Branch**: `fix/pet-walk-602`. Branched from `origin/feat/pet-beds-582`
  (#592), **not `main`**. Worktree `.claude/worktrees/pet-walk-602`.
- **PR #603 is open against `feat/pet-beds-582`, not `main`.** Do not retarget
  it. Everything below is pushed; the tree is clean.
- Work was **stopped mid-#605 to hold token spend**, not because anything was
  wrong. #605's code is written, committed, pushed and green locally; what is
  missing is the last verification lap. See "What is left" at the bottom.

---

## #602 — walk *to* the bed. Done, verified, pushed.

A pet's bedtime walk used to point the follow spring straight at the bed's
run-up spot. It now walks a `NavGrid` route.

**Verified in a real browser** on `/hotel-suite?pets=5`, napping in the west
bedroom (2 pet beds, so 3 of 5 companions are sent to the middle bedroom and
have a wall between them and their bed): **935 measured steps of the drawn
bodies, 0 partition crossings**, all five asleep.

`check:hotel` **probe 3d** is the regression check. Proved red by disabling the
routing in `Parade.aimAtBed`: **2 crossings over 65 measured steps against 14
built suite partitions**, first at `(-612.89, 1378.50) -> (-612.90, 1378.22)`,
exit 1. Green with it on.

## #605 — every *other* leg. Written and committed; verification unfinished.

Jim, on the #602 preview: *"when they get out of bed they warp through walls
again - I think this might be a wider bug - the pets should ALWAYS use normal
path finding by default to get to where they need to go, including while
following the player in a parade formation."*

### The measurements. Do not re-derive these — they are the expensive part.

All taken in a real browser on the built hotel suite, on the **drawn** bodies
(`Parade.petState(...).root`), against the 14 built suite partitions read out
of `CollisionWorld.forEachWall`.

**Which legs actually cross a wall:**

| leg | crossings | steps measured |
|---|---|---|
| parade following, walking her through every doorway | **0** | 26,180 pet-steps (5 pets × 5,236 frames) |
| walking to bed | **0** | (the #602 fix) |
| **waking / re-forming** | **3** | all three by the pets that had been in the middle bedroom |

The player's own path crossed 0 in the same run — that is the control on the
instrument. **Following is already a routed walk**: `trail.ts` exists to make
followers track the ground the player actually covered, and it works. The hole
is in the **joins**, not the follow. Jim's performance warning about planning
per pet per frame therefore falls away, and it was confirmed rather than
assumed.

**Distance from each drawn body to the player's breadcrumb polyline** — the
measurement the rule is derived from:

| | median | p90 | p99 | worst |
|---|---|---|---|---|
| ordinary following (8,965 samples) | 0.00 m | 0.045 m | 0.276 m | **0.366 m** |
| re-forming after a nap (4,460) | 0.00 m | 0.124 m | **2.441 m** | **5.926 m** |

**The rule, derived from that gap:** a companion within `ON_LINE_RADIUS`
(0.6 m) of the trail follows it as before; one that is not **routes back onto
it**. The threshold sits ~1.6x above the worst a follower ever reached and ~4x
below the p99 of one that has been put somewhere.

**Why distance to the *polyline*, never to the follower's own sample:** the
follow spring lags a long way — median 0.87 m, worst 1.41 m — but that lag is
*along* the trail, not away from it. A threshold on lag would fire on every
stride and still miss this bug. That distinction is the load-bearing part of
the design; `PlayerTrail.distanceTo` carries the numbers in its own comment.

The rule is **derived, not flagged**, and that is deliberate: it covers a bed,
the pets' table, the slide, a newly spawned member and a dropped trail with one
test, so a future way of putting a pet somewhere cannot be forgotten.

### What was built

- `src/entities/parade/trail.ts` — `PlayerTrail.distanceTo(x, z)`, nearest
  distance to the polyline. One pass over ≤250 crumbs per follower per frame;
  the only per-frame arithmetic #605 adds.
- `src/entities/parade/petRoute.ts` — was `bedRoute.ts`. `PetRoute` plans
  between two arbitrary points and serves waypoints, for both the bed leg and
  the rejoin leg.
- `src/entities/parade/Parade.ts` — `aimAt` applies the on-line test then calls
  the one `routeTo`; `aimAtBed` is now three lines that call the same thing.
- `scripts/check-hotel.mts` — probe 3d **extended** (not duplicated) to cover
  waking, with its own control.

### Three decisions already taken and approved. Do not relitigate them.

1. **`petNavGrid.ts` is deleted and pets route on `Game`'s existing `navGrid`
   — the player's own instance.** A companion-sized grid was written for #602
   on the reasoning that a pet is a third her width and cannot hop. It is
   unnecessary: a cold lattice build in the garden costs **919 / 896 / 843 /
   817 ms** across all four radius-and-jump-apex combinations, so **the walker
   is not what the lattice costs**, and a second grid charged the first nap
   another ~0.4–1.0 s of blocked main thread for nothing. **Do not re-add it**
   on the original reasoning — the numbers are in `petRoute.ts`'s own comment
   for exactly that reason. The one thing the wider walker costs (a run-up spot
   between two tightly packed pet beds can be unstandable at her width) is
   handled by the last-leg rule.
2. **The fallback must be printed.** A straight line that fires routinely is
   how this bug hides. `Parade.routingStats` counts four things and probe 3d
   prints them on every run: on her trail, on a planned route, on a route's
   short last leg (all three are routed walks), and **off the line with no
   route at all** — that last is the alarming one.
3. **Extend probe 3d, never write a second probe.**

### Proof, red and green

Probe 3d's waking clause proved red by short-circuiting the rejoin route in
`Parade.aimAt` (`if (process.env.LGP_NO_REJOIN_ROUTE) return;` before the
`routeTo` call), on the cast of 3 companions napping in bedroom 0 of the built
headless suite with 1 sent to the middle bedroom:

- **red**: `waking: 1 crossing(s) over 2697 measured steps`, first
  `toy.star#3 (-607.69, 1374.79) -> (-608.01, 1374.96)`, exit 1.
- **green**: `waking: 0 crossing(s) over 2697 measured steps`, control — the
  straight lines from bed to line would have crossed **3**. Exit 0.

Current green run of the whole note:

```
check:hotel — #602/#605 pet walk: 3 companions (1 sent to another bedroom) against 14 built suite partitions.
  to bed:  0 crossing(s) over 231 measured steps (control — the straight line this replaced would have crossed 2)
  waking:  0 crossing(s) over 2697 measured steps (control — straight lines from bed to line would have crossed 3)
  routing: 2727 member-frames on the player's own trail, 446 walking a planned route (10 plans), 1597 on the last leg of a route that stopped where the lattice could stop it (longest such leg 1.54 m) — all three are routed walks. Off the line with **no route at all**: 0, which is the number that hides this bug and is zero
```

### A trap that cost an hour, recorded so it does not cost another

**`Player.groundSampler` is installed by `Building.attachPlayer`, not by
`Hotel.attachPlayer`.** A headless probe that attaches only the hotel leaves it
`null`, `NavGrid` never gets a floor, `findRoute` is **never called at all**,
and the check goes green on the bug while looking entirely correct. Probe 3d
attaches the building for exactly this reason. (`typeof null === 'object'`, so
a `typeof` check "proving" the sampler exists lies.)

**A second one, mine:** `PetRoute.advance` must **not** clear `planned` when a
route runs out of waypoints. A route that honestly stops short of its goal —
the ordinary case for a run-up spot between two pet beds — then re-plans every
frame, and each fresh plan resets to a first waypoint the animal has already
walked past, so it jitters on the spot and never arrives. Symptom when I got
this wrong: *1 of 3 companions still not asleep 10 s into the nap, over 187
plans*. With it right: 10 plans.

---

## The `noRoute: 445` finding — closed, root-caused, fixed

**It was not a startup transient and it was not #608.** Measured in the
browser by wrapping `NavGrid.findRoute` and diffing `routingStats` per frame:

- Every `noRoute` frame had **both** the nav grid and the ground sampler
  present (`grid=true sampler=true`, 70/70 then 120/120). That kills the
  "before the lattice or the sampler is ready" hypothesis the old note
  offered.
- The lattice was **built** on those frames (`built: true`,
  `builtRevision === collision.revision`), so it is **not** #608's first-tap
  lattice stall either. Say so if anyone asks: #608 is still real and still
  unfixed, but it is not this.
- The actual cause: `/hotel-suite` puts **her** in the suite at
  `(-613.2, 1380)` and leaves all five **companion bodies** at the park
  spawn, `(-1.6, 51.6)`. The suite's lattice spans `x -630..-570,
  z 1350..1410`, so `cellAt(start) = -1` and `findRoute` honestly returns 0.
  `routeTo` correctly counted it. All 120 fell in frames **2–25** and none
  in the 2,193 frames after — the ~0.4 s the spring took to drag five
  animals 640 m across the park and in through the hotel wall.

**The fix**: `PlayerTrail.push` already detects the teleport (`TELEPORT_GAP`)
and resets; it now *returns* that fact, and `Parade.catchUpAfterTeleport`
re-places its followers on the new line. One owner of "was she moved?", no
second threshold. Members that are asleep/walking to a bed, at the pets'
table, or on the slide are left alone — the same three exclusions `update`
already makes.

After: **`noRoute` 0 over 1,688 frames, `findRoute` returned 0 zero times.**

## Verification done

**Browser lap for #605** (`/hotel-suite?pets=5`, port 5731), the drawn
bodies (`ParadeMember.root`) against the 14 built suite partitions:

| phase | pet-steps | crossings |
|---|---|---|
| walking her through four doorways | 19,320 | **0** |
| going to bed | 12,500 | **0** |
| waking and re-forming | 13,470 | **0** |
| second bedtime | 18,015 | **0** |
| second waking | 8,300 | **0** |
| **total** | **71,605** | **0** |

`routingStats` over the whole session: onLine 67,861, routed 4,064, lastLeg
29,140 (worst 1.54 m, under `SHORTFALL_TOLERANCE`), **noRoute 0**, 166 plans.
All five companions `asleep`, across bedrooms 0 and 1 — so 3 of the 5 were
sent through a wall to the middle bedroom, which is the case that matters.

**Three controls, all of which bit** (the instrument was proved before it was
believed):

1. The instrument reads the **pets**, not the player: 0 of 9,061 frames had
   pet coordinates identical to hers. (16 frames had two pets identical to
   each other — the moment after a teleport when they stack on her single
   trail crumb.) Use `m.root`; **never** `m.group ?? m.object ?? m.root`.
2. The crossing test **can** fire: a straight line across the suite crosses
   3 partitions, so "0" is not a tautology.
3. Her own path crossed 0 over 9,058 steps.

Two traps I hit, worth keeping:

- `forEachWall`'s 6th argument is `topHeight`, and in the **browser** it is
  `null` for a full-height wall (only low walls carry a number). A first
  draft filtered `top >= 0.8` and found **0 partitions** — an instrument
  measuring nothing. Treat `null` as full height; it comes out at 14, which
  is what the headless probe reports.
- `Hotel.petIsAsleep(bed)` takes a **bed entry**, and
  `Parade.petBedPhase(uid, spot)` takes **two** arguments. Calling either
  with just a uid returns a confident `false`/`null` — it reads exactly like
  "the pets never went to sleep" and is not.

**`check:hotel` probe 3d gained a third clause** (extended, not duplicated):
the teleport. Proved **red** with `catchUpAfterTeleport` short-circuited —
"a companion is still 10.65 m away — over half the jump (allowed 5.15 m)",
exit 1 — and green as shipped: 10.65 m before a 10.30 m teleport, **0.00 m
one frame after**, 0 no-route frames.

Its threshold is **half the jump, not a fixed metre count**, and that matters:
the first draft allowed a fixed 12 m for "the queue behind her", and the
suite is only 10.65 m across, so a companion left behind *entirely* measured
10.65 and **passed**. Only disabling the fix and watching the clause stay
green found that. `TELEPORT_GAP` is exported from `trail.ts` so the check
cannot drift from the game's own definition of a teleport.

## What is left

1. Gates on the current head — running as this was written; results go in the
   PR body.
2. Preview URL for Jim from #603's newest "Deploy PR preview" comment, loaded
   first, landing on `/hotel-suite?pets=5`.

## Two issues filed. Neither is this branch's to fix.

- **#606 — `check:park-boot` charges wall-clock to a generator-step budget.**
  It fails on a loaded box and passes on a quiet one. Interleaved A/B, base and
  branch alternating in one command on a quiet box: base 11.0 / 11.7 / 14.7 ms,
  branch 17.5 / 10.9 / 12.0 ms, all six passing at 1.00x calibration — the two
  populations are indistinguishable, so **no branch is implicated**. The
  failures came at 1.80–1.99x calibration, and three of the seven worst slices
  "did no generator step at all, 0 work units". **`feat/pet-beds-582` is clean
  on this check**, which is what clears #592.
- **#608 — the first tap in any space freezes the game for ~0.85 s** while the
  `NavGrid` lattice is built on the main thread (`TapNavigator.planRoute` →
  `findRoute` → `ensureLattice`). Pre-existing on `main`, untouched by this
  branch, and the same root cause as the deleted pet grid. **Jim has ruled it
  should be fixed by building the lattice in slices during park boot.** The
  four garden timings and the suite's ~1.0 s cold / ~0.43 s warm are in it.
  (Filed by me as #607; it is #608 that carries Jim's ruling — check both and
  merge if they are duplicates.)

## Practical notes

- Dev server: pick your own port with `--strictPort`. Mine (5491, 5492) are
  killed and the ports are free. No Chrome pages of mine are left open.
- `window.game` exists on a **dev** build only; a production/preview build does
  not expose it, so preview verification is visual and local verification is
  where the numbers come from.
- Drive the player headlessly with `game.tapNavigator.navigateTo(x, y, z)` —
  **three numbers, not a `Vector3`**. Passing a `Vector3` silently does
  nothing and she never moves.
