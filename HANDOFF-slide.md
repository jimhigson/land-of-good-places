# HANDOFF — E3-slide — GitHub #118, ginormous slide on the rail generator

Branch `feat/slide-on-rail-generator`, worktree `.claude/worktrees/slide`, dev port **5312**.

**Status: build green, procgen green, ready for QA. No PR raised (waiting on the
Overseer).** `npm run build` exit 0; `npm run test:procgen` exit 0, 122 tests.

Chute, exit node, first-person camera, grown-up, deep links and **supports** are
all done. The only thing left is the parapet-gap change, whose plan is with the
Overseer for approval (see the last section).

QA URLs: `http://127.0.0.1:5312/slide` and `.../slide-with-grownup`, private
window. Two links because the grown-up must be *invited* on the roof, so a
single link would silently skip the "in front, lying down" half of §9.

## Root cause of #118 (measured, not inferred — do not lose this)

The slide was **twelve hand-authored absolute world coordinates** in
`buildGinormousSlide()`. The castle moves per seed — `BUILDING_CENTRE_X/Z`
derives from `placedEntry('building')` nudged by `BUILDING_CENTRE_NUDGE` — and
those numbers did not move with it. The `gardenRoot` offset subtracts
`BUILDING_CENTRE_*` and adds it straight back, so they were literal absolute
world positions.

On the canonical seed **8 of the 12 points were inside the castle footprint**,
including both the first and the last. The last landed at facade-local
(4.54, 6.99) — past `ENTRANCE_MAX_X = 4`, i.e. behind a solid south wall
segment. That is why a child was boxed in.

It also never reached the ball pit: 22.07 m short, despite `anchors.ts` giving
the pit the sign subtitle "the ginormous slide lands here!" and the manifest
keeping it `near` the building so it stays "within a slide's reach".

## The four findings that changed the design

1. **`clearOfPlots` rejects every point between the castle and the pit.** Not a
   bug: the castle's plot bounding radius is 19 m, the pit's is 9 m, and their
   centres are 23.11 m apart, so the two circles overlap. A ride whose entire
   job is joining two plots can never satisfy the standard predicate. **Exempt
   exactly the two plots you deliberately join, honour every other one, and
   then re-impose the exempted one more precisely** — here the castle comes
   back as its actual footprint *rectangle*, which is what keeps the chute out
   of the tower rather than merely away from it. Derive from what was actually
   built; exempt deliberately and narrowly; never loosen globally.

2. **Clearance is owed only where two rides overlap horizontally, and is then
   vertical.** The first model demanded 5.5 m of air across a 7.2 m horizontal
   band, and that walls off the whole corridor: the Sky Cruiser crests at
   10.71 m and the slide starts at 14.84 m, so it is only ever 4.13 m above the
   coaster at its highest and could never pass over it anywhere. The ride was
   unsolvable for a clearance nobody required. `invariants.ts` already had the
   right shape — gate on a **narrow** horizontal overlap (`TRACK_CLEARANCE * 2`
   for rail-over-railway), then require the height. An over-wide band turns a
   clearance check into a wall, and the temptation is then to loosen the
   *height*, which is the wrong dial.

3. **Length is gradient when the drop is fixed.** Open routes overshoot
   `desiredLength` far more than loops do, because a loop is finished by a
   biarc to a start pose it has been steering at for a third of its length,
   while an open route's finisher only fires when a legal biarc to the target
   happens to exist. Asked for 68 m it produced 140 m — an 8° lazy river.
   `MAX_LENGTH` is enforced as a rejection in the ride's own predicate.

4. **A landing is only useful if the search can reach it.** The corridor the
   search steers at sits `APPROACH_DISTANCE` behind the end pose, and for most
   of the pit's rim that lands *inside the castle*. Half a million biarcs were
   rejected for curvature while aiming at somewhere unreachable. Landings are
   now filtered on whether their run-in is open — the same idea as the
   coaster's `stationPoses`.

## Measured site geometry (canonical seed 20260728)

```
castle centre      (-15.34, -21.79)   half extents 12.00 x 9.00   base Y 0.44
TOP_DECK 4         deckY = 14.84
facade slide door  local x 7.4..11.6 on the SOUTH (+Z) wall
door centre world  (-5.84, -12.79)
ball pit           ( 6.94, -27.93)    pit radius 6, plot bounding radius 9
door -> pit        19.81 m            drop 14.84 -> ~1.09 = 13.75 m
```

Note the pit is north-east of a south-facing door, so the chute must swing out
and wrap the castle's corner — which is also what earns the length a 13.75 m
drop needs to be rideable rather than a 44° plunge.

## Why the ride has its own speed

`SLIDE_SPEED` is 12 m/s and the little indoor helter-skelter keeps it. The
ginormous slide runs at its own **6.5 m/s**, because **12 m/s is 43 km/h, and
43 km/h through a six-year-old's own eyes is a different proposition from
watching it from outside.** This ride is now first-person, round a bend that
wraps a castle. First-person changes what a number means.

**If QA reports it feels tame, speed is the dial to turn, not the turn radius.**
The two are coupled — lateral load is v²/r — so loosening the radius to add
excitement would both make the route harder to solve and put the load back.

## Solved result, all five seeds

| seed | chute | steepest | tightest turn | lands from pit centre |
|---|---|---|---|---|
| 20260728 | 95.6 m | 15.4° | 6.20 m | 2.0 m |
| 2 | ~91 m | 17.4° | 6.08 m | 5.0 m |
| 5 | ~92 m | 15.4° | 5.46 m | 5.0 m |
| 11 | ~91 m | 15.4° | 5.91 m | 5.0 m |
| 18 | ~89 m | 15.9° | 6.50 m | 5.0 m |

Zero rising control points on every seed. Pit radius is 6, so every seed lands
in the balls.

## What QA should ride, and the worst case

Canonical seed. Use `/slide` or `/slide-with-grownup` (see the top of this
file) rather than walking into the castle and climbing four decks — that is
what they are for.

**Worst case for comfort: the tightest bend is 6.20 m radius, 10.6 m along —
11% of the way down, only 1.6 s in, at full roof height (14.8 m).** It is 0.69 g
laterally. So the hard moment is a sharp turn at altitude immediately after
leaving the door, *before* the drop begins — not somewhere in the middle. Full
ride is 14.7 s.

## Coordination with E4-castle-window

Resolved structurally, not by negotiation and not by a reserved corridor (Jim
ruled reserving space out: "it should all be procgen"). The slide treats the
Sky Cruiser's **solved geometry as an obstacle like any other**, reading it from
`COASTER_PLANS` at module load. Whatever route E4 lands, the slide solves around
it. One consequence: the cruiser solves before the slide at module load, so if
the cruiser ever fails to solve, the slide fails too — loudly.

## Watch out for

- **Squash merges hide staleness.** PR #196 (#114) landed squashed while this
  branch was open, so `git merge-base --is-ancestor` said "not an ancestor" and
  nothing warned that `paths.ts` here was a stale copy that would have reverted
  it. Rebased; verified with `git diff origin/main...HEAD -- src/world/paths.ts`
  showing only the two intended additions.
- **A worktree with no `node_modules` silently resolves up into the shared
  checkout's.** It does not fail; it just is not testing what you think.
  `npm ci` in the worktree.
- **A headless park is never rendered, so every `matrixWorld` is the identity.**
  Sampling built geometry without forcing an update gives local coordinates
  wearing world coordinates' clothes, and every clearance check built on them
  passes for free.
- **A plot's anchor is not the thing standing on it** — the facade is ~3.5 m off
  the `building` plot's position.

## The supports (`slide/supports.ts`)

Six legs per seed, 2.5 m to 14.6 m tall. Sparse on purpose: the ground under
the chute is ground a child walks on, and a tidy row of posts is a fence.
Closest pair across the seeds is 3.0 m centre to centre — 2.16 m between faces
against a 1.24 m child — and that is asserted, not eyeballed.

Two bugs found only by measuring, both worth remembering:

- **It placed zero legs on every seed, silently.** The "don't pinch a plot
  corridor" rule counted the castle and the ball pit, whose circles blanket the
  whole ride: 37 viable spots rejected, nothing built, nothing said, all tests
  green. Same overlapping-circle trap as the route, same fix.
- **`check:park` caught a leg 19.11 m from the castle against its declared 19 m
  `boundingRadius`, and it was right** — content past that radius is content
  nobody routed around. Fixed by moving the legs to park level rather than by
  touching the ratchet: this ride spans two plots, so its supports are the
  park's, not the tower's. Note the check measures each lump's **centre**
  distance, which is why the 95 m chute itself passes (its bounding-sphere
  centre sits near the tower) while one small post out at the edge does not.

## Two traps that make a test inert while looking green

Both cost other engineers real time on 5 August; both would have defeated the
negative-fixture proof silently.

- **A static import of a seed-dependent module into `test/` pins every seed to
  the default park.** `LGP_SEED` is read once at `parkManifest.ts` load, which
  is why `buildParkFacts` sets the env var and only *then* imports dynamically.
  The tell is the **pass** count looking wrong, not the fail count. Read things
  off `ParkFacts`; `import type` is fine, it is erased.
- **A `NaN` comparison makes an invariant incapable of failing.** `NaN < best`
  is always false, so a running minimum stays `Infinity` and every threshold
  test passes. `test/` is not typechecked, so nothing warns.

Checked against this branch, with evidence rather than confidence: each of my
two invariants appears exactly 5 times in a verbose run (one per seed); test
count went 117 -> 122, exactly +5 for the new one; the red output carries real
numbers throughout; and I ran the negative fixture against **seed 5** as well as
the canonical seed, which is the specific thing a static import would break.

## Still open / not done

- **The parapet gap.** Still a fixed local x on the south wall. Plan is with the
  Overseer: the search *already* chooses the door (`report.startPoseIndex` names
  the start pose it took) so this is mostly a matter of not throwing that answer
  away, plus moving four constants out of `layout.ts` so the dependency runs
  `layout -> slide/plan -> Shell` and no cycle is created. The payoff is being
  able to offer the whole wall as candidate positions, which should buy back the
  turn radius I spent to make seed 5 solve (5 m today) and so lower the 0.79 g
  worst bend. It visibly relocates a hole in the castle, so it likely needs
  family screenshot approval.
- **East-wall door** deliberately not proposed yet: the pit is east of the
  castle so it is the natural face, but `Shell.ts` only cuts gaps in the south
  wall at TOP_DECK. Argue for it on evidence after the south-wall version.
