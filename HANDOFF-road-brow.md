# HANDOFF — `entranceRoadBrow()` collapses to 1 m (branch `fix/road-brow`)

**Branch `fix/road-brow`, off `feat/sphere-combined` at `2be47b83`. Model:
Opus** (a replacement must also be Opus). Worktree was
`.claude/worktrees/road-brow`, removed on stopping.

**STATE: no code changed. Investigation only, root cause nailed down further
than the previous handoff had it, plus one measurement that decides the fix and
one that blocks the obvious version of it.** Work was stopped by the Overseer
mid-investigation (token budget), not because anything was finished. Everything
below is measured on this branch, not reasoned.

Read `HANDOFF-no-hill-511.md` on this branch first — it owns the wider #511
picture. This file only covers the brow.

## Jim's acceptance test, in his own words

> **"ok make the cat bus arrive from further away then I guess"**

The outcome he will judge: **she sees the bus coming from a distance, rather
than it appearing at the kerb.** `check:entrance-road` reaching a real verdict
and `check:swept-bus` reporting honest coverage are how that is *proved*; they
are not the point of the work.

It needs **a frame he can judge**, captured in a browser with the bus
mid-approach, at his window shape — **roughly 2000x1100, wide and short**. Send
it to the Overseer with the preview URL taken fresh from PR #600's own "Deploy
PR preview" comment, loaded by you first.

## The red state, quoted off the screen before touching anything

`pnpm run check:entrance-road`, exit **1**:

```
  control: with the corridor off the ride puts 0 legs back in the bus's path across 10 seeds (worst 0.00 m inside a bus) — the sweep can see a collision
  covered: 10 seeds x 2 parks (real and control), 14183 trestle legs, bus swept from the brow at +1 m to -1 m

FAIL: the entrance road runs through the Rail Race.
  - the control found NO collision on 10 seed(s) — with the road's corridor
    switched off the Rail Race puts its legs back through the road, so the bus is
    supposed to sweep through them. Reading zero there means this sweep cannot
    see a collision at all, and its verdict on the real road is void
```

That control is doing its job. **When you fix this, the control going
meaningful is the pass condition, not the FAIL going away** — a check that
moves from "void" to "passing" while its control still finds nothing has not
been fixed, it has been silenced.

## Root cause — sharper than `HANDOFF-no-hill-511.md` had it

That file says the brow collapses because "the sphere descends from the first
metre, so there is no crest to find". **That is not what happens.** Measured:

```
ENTRANCE_ROAD_OUTSET 19.07 vs RIM_OUTSET_START 12
extent -72.95 .. 72.77 (length 145.71 m), reach 72.77, brow 1.000
```

`browAt()` in `src/world/entrance/roadRoute.ts` walks the stations outward and
returns the first one where `entranceRoadOutsetAt(...) >= RIM_OUTSET_START` (12).
**`ENTRANCE_ROAD_OUTSET` is now 19.07 m** — the road's whole centre line, gate
included, is already outboard of the old rim line, because the sphere removed
the ceiling that used to crush the road inboard of the ride
(`ENTRANCE_ROAD_OUTSET = max(DOOR_PAVEMENT + BUS_DOOR_INBOARD,
outsetClearOfSupports(ROAD_HALF_WIDTH))`). So the predicate is **true at the
very first station** and the loop returns `STATION_SPACING` — 1.000 m — every
time. It is a predicate that can no longer be false, not a crest that cannot be
found. Same fix either way, but the next reader should not go looking for a
gradient that never fires.

## The measurement that decides the fix

**A grade-based brow will never fire on this branch.** Grade under the road,
measured station by station (`d / GROUND_SPHERE_RADIUS`, `BUS_MAX_GRADE` = 10%):

```
  at -72.9  origin-dist 112.38  grade 9.36%
  at -40.0  origin-dist  95.86  grade 7.99%
  at   0.0  origin-dist  79.63  grade 6.64%
  at +40.0  origin-dist  99.63  grade 8.30%
  at +72.8  origin-dist 115.79  grade 9.65%
```

The steepest ground anywhere on the road is **9.65%**, inside the 10% budget, at
the road's own far end. So "walk out until the grade exceeds `BUS_MAX_GRADE`"
returns **the end of the road** — which is, in fact, the right answer, and it is
the answer `GROUND_SPHERE_RADIUS`'s own doc already assumes: the radius was
chosen as `117.08 / 0.10` from *the drawn road's full reach*, i.e. the sphere
was sized so a bus could drive **the whole road**.

**So the recommendation, which you should judge rather than obey:**

> `entranceRoadBrow()` becomes **the road's own reach** — `entranceRoadReach()`,
> 72.77 m — clamped by the grade budget rather than searched for by it. One
> owner (`entranceRoadExtent`, itself owned by `TERRAIN_APRON`: the road ends
> where the drawn ground ends), derived from the ground, and it degrades
> correctly on any future ground because the grade clamp is still there to bite.

Keep `RIM_OUTSET_START` out of `roadRoute.ts` entirely when you do — it is a
property of a hill that no longer exists, and leaving it as a dead-but-true
predicate is exactly the stale comment CLAUDE.md tells you to correct where you
find it.

That gives: **the bus drives the full 145.7 m road** (72.77 m in each direction
from the gate) instead of the 2 m it drives today — 1.4% -> 100%.

## ⛔ The blocker nobody has hit yet: the roll-in is a fixed 3 seconds

`ArrivalSequence.ts`: `ROLLING_IN = 3.0` seconds, and `rollIn()` lerps
`entranceBusArriveAt()` -> `stopAt` across that phase.

- **Today:** 1 m in 3 s = **0.33 m/s.** A bus creeping one bus-nose forward.
- **With brow = 72.77 m and `ROLLING_IN` untouched:** 72.77 m in 3 s =
  **24 m/s, 87 km/h**, into a stop. Absurd, and it will look it.

**So widening the brow alone is not the fix, and a replacement must not push it
as one.** `ROLLING_IN` has to stop being a constant and become
`approach distance / a bus speed` (or the departure equivalent for
`BUS_PULLS_AWAY = 3.0`, which has the same problem in reverse). At a plausible
~9 m/s the full 72.77 m approach is about **8 seconds**.

**This is a judgement for Jim, and it is the one thing in this ticket he should
be asked about rather than told:** 8 seconds of bus approaching is either a
lovely arrival for a six-year-old or a long wait before she can play, and the
brief already says an absurd result in either direction is a finding to raise
before pushing, not a number to accept because it fell out of a formula. If 8 s
is too long, the honest lever is the **speed**, not the brow — she should still
first see the bus far away.

Do not simply keep 3 s and shrink the brow to fit it. That reintroduces a
hand-picked distance, which is what the brow existed to abolish.

## Still to do, none of it started

1. Fix `browAt()` per above; delete the `RIM_OUTSET_START` import and rewrite
   the doc comment on `entranceRoadBrow()`, which currently describes a hilltop.
2. Derive `ROLLING_IN` / `BUS_PULLS_AWAY` from distance and a bus speed. **Ask
   the Overseer before choosing the seconds.**
3. **Make `check:swept-bus` state its own coverage on every run** — swept length
   in metres and as a fraction of the road's length, e.g.
   `swept 145.7 m of a 145.7 m road (100%)`. **Not done. The check is still
   silent about it.** This is the part of the brief that matters most
   independently of the brow: a gate covering 1.4% of what its name claims,
   with nothing in its output admitting so, is the fault this repo cares about
   most, and it should not be possible again. Write it to `process.stderr` if it
   goes through vitest; this one is a plain script, so `console.log` is fine.
4. Re-run `check:entrance-road` and **confirm the control now finds collisions**
   (a non-zero "worst N m inside a bus"), not merely that the check exits 0.
5. `check:cat-bus` should stop printing `bus travelled x 0.8 to -1.1`. Note it is
   **independently RED** on this branch for the doorway-gap clause
   (`tightest gap 0.63 s (needs 0.64)`) — that is a separate fault, written up
   in `HANDOFF-no-hill-511.md`, and it is not yours unless you are told it is.
6. `test/procgen/invariants.ts`'s `theGroundIsTheSphereItClaimsToBe` prints
   *"Asserts nothing about ground beyond the park's own boundary, where the road
   and the bus still run"* — while `BUS_MAX_GRADE`'s own doc in
   `constants.ts` claims the invariant *"walks the bus's own arc on the built
   park"*. **Those two disagree, and the constant's doc is the wrong one.** Once
   the bus really drives the whole road, extending that invariant to the bus's
   actual arc is the natural same-PR addition CLAUDE.md asks for, and it makes
   the constant's promise true instead of aspirational.

## The coverage finding, carried forward whether or not it is fixed

**`check:swept-bus`'s green headline — "0 intruding posts on 14 seeds" — covers
2 m of a 145.7 m road: 1.4%.** That number has been quoted as acceptance
evidence for the road merge, including by the Overseer and in PR #600's body.
It is not wrong, it is **narrow**, and nothing in its output says so. Discount
it accordingly until item 3 above is done.

**Widening the sweep may turn up posts.** If it does, that is a finding to take
to the Overseer with the numbers written down plainly — how many posts, which
seeds, worst intrusion in metres — **not a regression to hide and not a reason
to leave the sweep narrow.**

## Housekeeping

- No dev server was started. No browser page was opened. Nothing to kill.
- No file under `src/`, `scripts/` or `test/` was modified. `git diff --stat
  origin/feat/sphere-combined...HEAD` should show **this file only**.
- No PR opened. When one is, it goes against **`feat/sphere-combined`**, not
  `main`.
- Two other engineers are on this branch family — the arrival camera on
  `feat/sphere-combined` itself, and the `check:coplanar` findings on
  `fix/coplanar-sphere`. Stay out of their files; rebase rather than resolve by
  hand.
