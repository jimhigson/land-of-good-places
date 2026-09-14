# Scale 1: the ten tests it unmasks, and a rebase that applied cleanly and lied

Three separate things for the Overseer to route. None of them is this branch's
own lane; all were measured on it.

---

## 1. The rebase collision — write this into CLAUDE.md if it recurs once more

**Two engineers found the same defect and corrected opposite halves of it. Git
applied the rebase with no conflicts and produced a file that contradicted
itself.**

`PARK_SURFACE_SCALE`'s docblock claimed the scale was 1 while
`PARK_REFERENCE_SPHERE_RADIUS` was 1200 (making it 2.335). Classic "two
definitions of one thing kept in step by hand", and both lanes found it
independently:

- **#619** corrected **the paragraph** — kept 2.335x, demolished the stale
  diagnosis that had justified it, and fixed the real blocker in `paths.ts`.
- **`eng/sphere-ground-claims`** corrected **the constant** — took it to
  `GROUND_SPHERE_RADIUS`, restoring scale 1.

Neither touched the other's lines. So the rebase had **nothing to conflict on**,
and merged my constant with their paragraph. The file arrived reading:

```
 * **This is 1200 while `GROUND_SPHERE_RADIUS` is 220, so the scale is 2.335 ...
 */
const PARK_REFERENCE_SPHERE_RADIUS = GROUND_SPHERE_RADIUS;
```

The docblock and the constant disagreeing — **the exact bug both commits
existed to fix, recreated by a clean rebase of both fixes.**

### Why it is worth writing down

CLAUDE.md already says *"a rebase with no conflicts is not reassurance — that is
the exact shape of a silent revert."* This is a **second shape** of the same
hazard, and it is one the existing advice does not catch:

- The three-dot diff is clean — every hunk is genuinely mine.
- Nothing was deleted, so "account for every file" finds nothing.
- Both sides' *changes* survived intact. What did not survive was their
  **agreement**.

The tell is not in the diff at all. It is that **a doc comment and the code it
describes are two definitions of one thing**, so when two branches edit a
docblock and its constant separately, git's line-level merge cannot see that
they are the same fact. Conflict detection is lexical; the invariant is
semantic.

**The check that would have caught it:** after any rebase touching a constant
whose docblock states its value, *read the docblock against the value*. Cheap,
and this is at least the second class of silent-rebase damage this repo has
paid for.

---

## 2. The ten tests scale 1 unmasks, with what each actually fails on

Final numbers, whole suite, diffed by name:

| | passed | failed | pending |
|---|---|---|---|
| #619 base (scale 2.335) | 501 | 128 | 0 |
| this branch (scale 1) | 553 | 95 | 0 |

Net +52 passed, −33 failed. **These ten are the ones the net hides** — they pass
at 2.335x and fail at scale 1. They are **not** kernel regressions: the geodesic
kernel measured 0 newly failing and 0 newly passing across the whole suite.
Scale is a layout input, so the seeds land differently and hit different
problems. A test that passes at one scale is not evidence the thing it tests is
sound.

### Sky Cruiser / coaster — 3 tests, probably one defect

**seed 131 — `the Sky Cruiser built track turns as gently as it promises`**
> the Sky Cruiser's built track turns at **9.91 m radius** 42 m along the loop,
> tighter than the 12 m it promises — the plan was validated but the rebuilt
> curve does not honour it

Plan-versus-build disagreement, not a solver failure. The plan validated at 12 m
and the rebuilt curve came out at 9.91 m.

**seed 24 — `the Sky Cruiser flies clear of the whole park`**
> the car passes through `crenellations` at 220.0 m along the loop, world
> (−68.77, −1.36, 14.83); `castle-wall-lintel` at 221.0 m; `castle-roof-deck` at
> 222.0 m; `roof-pavilion` at 222.0 m

**seed 24 — `the Sky Cruiser fits through the window it cut in the castle`**
> the car's underside strikes `castle-wall-lintel` at 220.2 m, world
> (−68.23, −1.36, 15.37); `castle-roof-deck` at 220.4 m

The last two are almost certainly **one defect seen twice** — same loop
position (~220 m), same meshes, same corner of the castle. Note the car's `y` is
**−1.36** while it is striking a roof deck and crenellations: worth checking
whether the cruiser's height is being read in the wrong frame (this branch's
whole subject is charts that disagree), rather than assuming the window is cut
wrong.

### Ginormous slide — 2 tests

**seed 24 — `the ginormous slide does not clip the castle towers`**
> passes **1.57 m inside** `tower-roofs[3]` at (−44.91, 7.60, 23.18) — **10 of
> 185** sampled points are inside a tower, and a child rides through solid
> masonry

**canonical — `the slide goes downhill all the way, lands in the ball pit...`**
> the ginormous slide **climbs 0.001 m** at (53.3, 9.7, 35.9)

The canonical one is a **millimetre** — 0.001 m against a threshold of zero. That
is a hairline, plausibly float noise on a re-scaled layout, and it should be
looked at before it is chased: the right fix may be an epsilon in the assertion
rather than work in the slide. The seed-24 one at 1.57 m is real.

### Paths / paving — 2 tests, seed 24

**`every paved path runs on grid axes`**
> the paving from (−29.5, −45.4) to (−23.3, −30.6) runs **diagonally for 16.0 m**
> (drawn by `spur-stall.spookyHouse`, `spur-stall.waterFight`, `spur-waterFight`)

**`no two close destinations are left with a wildly disproportionate paved detour`**
> `ferrisWheel` and `exit-ferrisWheel` are **9.5 m apart in a straight line but
> 270.8 m apart by paving (28.51x**, wasting 261.3 m)
> `stall.spaceFerrisWheel` and `exit-ferrisWheel`: 11.4 m straight, **272.0 m by
> paving (23.86x)**

The second is severe and concrete: a ride's **exit is 270 m of walking from the
ride**, 28x the straight-line distance, with no direct connector. A child
leaving the ferris wheel walks most of the park to get back to it. This one
looks like a genuine missing-connector defect rather than a scale artefact.

### Scatter / foliage — 2 tests, seed 326

**`no two trees interpenetrate`**
> trees at (−82.7, −38.5) and (−75.4, −38.0) by 0.06 m; (−65.1, −51.8) and
> (−68.9, −56.8) by **0.59 m**; (−65.1, −51.8) and (−62.8, −47.4) by 0.58 m;
> (46.9, 49.9) and (51.2, 50.9) by **0.94 m**

**`no tree grows into a wall`**
> tree at (−14.5, −10.0) reaching 2.18 m leaves 1.18 m to the stone run
> (−17.8, −8.3 → −17.8, −3.2)

Note one tree at (−65.1, −51.8) appears in **two** of the interpenetrations, so
the count of distinct bad placements is smaller than the count of pairs.

### Bridges — 1 test

**seed 131 — `every railway crossing has a bridge you can walk to, onto and across`**
> the crossing at (−3.8, 35.2) **climbs 0.593 m in one sprinted frame**,
> −14.5 m along its own centreline — a child running up it on a slow device
> falls through her own deck. One clamped frame (0.0833 s) carries her 0.925 m,
> and `WalkSurfaces.sample` only reaches `BUILDING_STEP_UP` (0.62 m)

A real playability defect with the arithmetic already worked out in the message:
0.593 m needed against a 0.62 m reach, on a frame that carries her 0.925 m.

---

## 3. Two things measured here that belong to someone else

### `scatterDecoupling.test.ts :: can tell two parks apart at all` — flaky

Fails in the **full suite** on both `eng/sphere-ground-claims` **and** #619's
base; passes **3 of 3** runs in isolation. So it is order- or
parallelism-dependent, it is **pre-existing**, and by CLAUDE.md's rule
(*"flakiness is equal to failure"*) it needs a root cause rather than a retry.

Worth noting what it is: a **control** — the test that proves the
scatter-decoupling instrument can distinguish two parks at all. A flaky control
is worse than a flaky assertion, because when it is silently passing nobody
knows whether the assertions beside it mean anything.

### `check:ground-claims` **crashes** on the pre-#619 base rather than failing

On `feat/sphere-combined` before #619 it did not report a failure — it threw,
during park generation:

```
Error: rail crossings: the drawn paths cross the railway at railD 0.0
(0.0, 125.8), which snaps to no proven bridge site. Every crossing must be a
bridge (Jim, 2 Sep 2026); find the router that drew this leg.
```

This matters beyond the fixed bug: **an agent running that check on its own
branch sees a stack trace and reasonably assumes its own diff caused it.** I
nearly did. The general lesson for the fleet is the one that cost me a detour —
**measure the base before attributing a failure to your own diff**, and prefer a
throwaway worktree at `origin/<base>` over reasoning about it.

(#619 fixed the underlying crossing bug, so this no longer reproduces on the
current base. Recorded because the misattribution hazard is the durable part.)
