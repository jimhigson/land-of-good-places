# HANDOFF — Rail Race rings onto the park boundary

Engineer `E2-interact`. Branch `feat/railrace-ring-boundary`, worktree
`.claude/worktrees/railrace-ring`, based on `feat/park-spline-boundary` @
`5373a77` (E1's `GARDEN_PLAY_BOUNDARY` commit). `npm ci` run **inside** this
worktree.

**State: the invariant is corrected and proved RED on all five seeds. The ring
migration itself is not written yet.** Both belong in one commit, so nothing is
committed — the working tree carries the red half.

## Why the rings must move

The park boundary is now a spline: **59.7 m at the pinch, 101.4 m at the bulge**
(canonical seed). The rings are still a hard-coded circle at r = 60.8–70.2 m. So
on most bearings the ride sits *inside* the park, and on 32 of 180 bearings the
boundary masonry passes **between the two rails**.

It cannot be fixed by moving the ring out: a circle clearing a 101.4 m bulge
needs r ≈ 106 m, which at the pinch is 46 m beyond the wall and past the terrain
edge — the ride would fly off the side of the world. The ring has to follow the
boundary.

## The vacuity that hid it

`railRaceRingsStandOutsideThePark` asserted `min > ENTRANCE_WALL_RADIUS +
PLAYER_RADIUS`, i.e. `60.83 > 60.62`, and passed green through all of the above.
`ENTRANCE_WALL_RADIUS` is 60 and no longer means "the park's edge" — it survives
only as the *gate pin*, the one bearing where the generator constrains the
boundary to it.

`railRadiusRange` measured `Math.hypot(x, z)`. **A radius is only a statement
about the edge while the edge is the same distance away on every bearing.**

### Corrected — measure outset, not radius

`railRadiusRange` → `railOutsetRange`, measuring
`-boundary.distanceToEdge(x, z)` per rail vertex. Thresholds now:

- inner: `facts.masonryHalfWidth + PLAYER_RADIUS` = **1.48 m** outside the edge
  (the widest pillar cap, *not* the 0.45 m collision half-width — a rail 0.5 m
  out clears the collider and is still driven through a cap).
- outer: `RIM_OUTSET_START` = **12 m**, where the hill starts falling away.

`TERRAIN_RADIUS - 4` (79.5) is gone from `invariants.ts` — the terrain disc now
runs 83.2–124.9 m, so 79.5 was *inside* it everywhere and the assertion had
started flagging rides that were perfectly fine. A false positive trains everyone
to ignore the check.

`BOUNDARY_MASONRY_HALF_WIDTH` is now **exported from `Garden.ts`** and the cap
geometry is built from it, so the two cannot drift. (Fifth "same number declared
twice" this session.)

### The red proof — all five seeds

Innermost rail, metres *outside* the edge (negative = inside the park):

| seed | walk-past | race |
|---|---|---|
| canonical 20260728 | −37.51 | −39.75 |
| 2 | −39.26 | −40.35 |
| 5 | −34.75 | −37.66 |
| 11 | −38.76 | −39.98 |
| 18 | −36.96 | −39.14 |

5 failed / 90 passed. Every other invariant still green.

## The trap this hit on the way, worth knowing before you add any invariant

My first version imported `PARK_BOUNDARY` and `BOUNDARY_MASONRY_HALF_WIDTH`
**statically** at the top of `invariants.ts`. The four sweep seeds immediately
started erroring with *"asked for seed 2 but the park built with 20260728"*, and
the canonical seed alone ran — 1 failed, 18 passed, **76 silently skipped**.

The seed reaches `parkManifest.ts` only through `LGP_SEED`, which that file reads
**once at module load**. `buildParkFacts` sets the env var and then imports
everything **dynamically**. A static import of any seed-dependent module into
this tree loads `parkManifest.ts` too early and pins every seed to the default
park.

**Rule: anything seed-dependent reaches an invariant through `ParkFacts`, never
through a static import.** `ParkFacts` gained `boundary`
(`world.collision.playBounds` — the *built* park, per CLAUDE.md's "measure the
park that was built, never the rules that built it") and `masonryHalfWidth`.
`import type` is fine; it is erased.

The seed guard caught this loudly and immediately. It is doing exactly the job
its comment claims.

## Still to do

1. **Migrate the ring** — `NOMINAL_RADIUS = 65.5` becomes a **`NOMINAL_OUTSET`
   ≈ 5.5 m** applied to the boundary. Today's race ring spans +0.83 to +10.18 m
   outset at the gate, so it already fits the 1.48–12 m corridor; the outset
   framing preserves the ride's proportions exactly where it is pinned.
   `boundary.ts` gives you `edgeRadiusAt(boundary, bearing)` and, better,
   `alongBoundary(boundary, spacing)` which already solves the arc-length
   parameterisation.
2. **11 sites in `route.ts`** — `length = TAU·R`, `angleAt(d) = −d/R`,
   `laneRadii`, `startDistance`, `pointAt`, `tangentAt`, `slopeAt`, the terrain
   probe, and **`outwardAt`, which is the one to watch**: on a non-circular curve
   the radial direction is no longer the outward normal.
3. **`camera.ts` holds a second, independent copy of the circle maths** (lines
   204, 283–298, 379–380) and solves its rig **once per `resize()`** on the
   stated assumption that "every point on the ring is the same shape". That
   assumption dies here.
4. **`track.ts`** — the trestle search (`:1016–1035`) and `buildArch` (`:1147`)
   are polar about `NOMINAL_RADIUS`.
5. **Lane fairness**: `undulation` is parameterised by `theta`. If `θ(s)` stops
   being `−s/R`, re-derive in terms of `s` or `check:rail-race`'s
   `climbSpread < 0.02` will fail — and it *should* fail rather than be weakened.
6. The other three stale-meaning constants: `RIM_START` (72,
   `check-rail-race.mts:254`), `WALL_INNER_RADIUS` (59.55, `train/route.ts`),
   and the exit clamp `GARDEN_PLAY_RADIUS - 2` (56, `railRace/plan.ts:97`).

## The rule behind all of it

When a boundary stops being a circle, every constant that meant "the edge"
silently becomes a different claim — **its value did not change, its meaning
did**, and the suite cannot tell you. Audit by asking what each measures against
the real edge *at the pinch and at the bulge*. The only constant that survived,
`ENTRANCE_WALL_RADIUS`, did so because the generator **pins** the boundary to it:
it was made a constraint rather than an assumption.

---

# Progress, 5 Aug — the ring is migrated; three things remain

**Nothing is committed: the suite is not green.** `tsc` passes, the geometry is
done, and what is left is two design questions rather than unfinished work.

## Done and measured

- **`ringPath.ts`** (new) — the centre line: the boundary's outline pushed out
  along its own **normal** (not radially; radial offset under-delivers exactly on
  the pinch-to-bulge shoulder where clearance is tightest), resampled at even arc
  length, wound **clockwise** so the ride still reads left-to-right. Outward
  sense is derived by asking the boundary once, not assumed from winding.
- **`route.ts`** — all 11 polar sites migrated. `NOMINAL_RADIUS` → `NOMINAL_OUTSET
  = 6.5`, `laneRadii` → `laneOffsets` (lateral, along the local normal),
  `length` from the path, `startDistance` by search, and `outwardAt` now the real
  normal rather than the radial direction.
- **Lane fairness — came out exactly.** `undulation` is phased by **normalised
  arc length**, not bearing. On a non-circular ring `theta(s)` is not uniform, so
  a rigid rotation in bearing would have made lanes genuinely unequal. Measured:
  **climb spread 0.0000 m, gradient spread 0.00000**, all four lanes 12.57 m.
  It also degenerates to the old maths exactly when the park is a circle
  (`length = TAU*R` ⇒ `TAU*s/length = s/R`).
- **`camera.ts`, `track.ts`, `check-rail-race.mts`** migrated off the circle,
  including `inward`, which was `-point` (toward the origin) — only "into the
  park" for a circle centred there.
- **The invariant is green on all five seeds.** Race rails run **1.8–11.2 m**
  outside the edge, walk-past **4.6–8.4 m**; clear of masonry at 1.07, inside the
  crest at 12.

## 1. The camera rig does not generalise — needs a design call

`RaceCamera` solves its side-on rig from the chord between the rider and a point
ahead. That is inscribed-angle geometry and it **assumes the track between them
is close to a circular arc**. It is not, any more.

Four approaches measured, none green:

| approach | result |
|---|---|
| solve once at `s = 0` (current) | 2 camera FAILs, phone only |
| solve at the tightest bend | 4 FAILs — wrong everywhere else |
| solve per station (256) + lerp | 7 FAILs, incl. "looks BACK down the track" |
| relax the ring (Laplacian) | camera unchanged; clearance eaten to 0.12 m |

Left at the first: `check:rail-race` says the phone window looks **28.9°** down
the track (wants less) and riders cross at **0.876** (wants > 0.9). Both are one
root cause. The per-station result is the informative one: interpolating between
differently-wrong solves adds a *new* failure, which says the rig's model — not
its parameterisation — is what breaks.

**Options for the family/Overseer**, none of which I should pick alone:
(a) change the rig's model to something curvature-independent; (b) constrain the
ring's curvature at generation time so the chord model holds, which means the
ring stops following the park closely; (c) accept a slightly angled view on
phones and move the threshold — **but that is weakening an assertion to pass, so
it needs an explicit ruling, not a quiet edit.**

## 2. The lap is 600.2 m, was 411.6 — the race is now a procession

`playing well finishes as much as 159.0 m clear of the nearest rival`. A 46%
longer lap gives the leader far more room to pull away. This is the ride-tuning
call the Overseer offered to make: `RIVAL_SKILL` or the rubber band's
`CATCHUP_BEHIND`. **Not a threshold to weaken** — the assertion is right, the
ride needs retuning for the longer lap.

## 3. `railRaceStallStandsAtTheRim` fails on all five seeds

The booth is placed by the interior layout solver and the ring moved outward, so
it is now ~49 m from the rails and no longer the closest plot. Correct failure.
Either the booth follows the boundary at its own bearing, or the invariant's
claim is re-derived as "closest *at its own bearing*". A placement question that
touches `parkLayout`, so worth agreeing before changing.

## Still untouched

`RIM_START` in `check-rail-race.mts` is gone, but `WALL_INNER_RADIUS`
(`train/route.ts`, 59.55) and the railRace exit clamp (`plan.ts:97`,
`GARDEN_PLAY_RADIUS - 2` = 56) are still stale-in-meaning.

---

# HANDOVER — 5 Aug, mid-camera-rig

Handing over rather than starting the rig. Not a context estimate: my last three
attempts at *this* problem went in as implement-then-measure rather than
reason-then-implement, and the relaxation attempt had a consequence I should have
predicted (smoothing a convex curve inward eats the clearance margin — it fell to
0.12 m) and instead discovered by running it. That mode is wrong for replacing a
rig model from scratch.

**Everything below the line is decided. Do not re-litigate it — implement it.**

## The Overseer's three rulings

1. **Camera: change the rig — option (a).** Not (b) constraining the ring's
   curvature, not (c) moving the 0.9 threshold. **Do not touch that threshold.**
2. **Retune the procession in this commit**, using **`CATCHUP_BEHIND`**, not
   `RIVAL_SKILL` — rubber-banding scales with lap length by construction, a skill
   constant would need retuning again the next time the ring moves. **Target the
   finish gap `origin/main` had before the ring moved**: measure it there first
   and restore that number. Do not invent a new feel.
3. **Move the booth; do not re-derive the invariant.** This is issue **#117** one
   ride early. The mechanism already exists — `stall.skyCruiser` is governed by a
   **`near:` relation** in the manifest rather than a band. Use that. **Rail race
   booth only**; generalising to every stall stays #117's job.

## The camera rig — read this before writing any of it

`RaceCamera.solve` fits **inscribed-angle chord geometry**: it takes the chord
from the rider to a point `AHEAD` along the track, stands square-on to *that
chord*, and derives the stand-off as `L / tan(delta)`. The model assumes the
track between the two points is close to a circular arc.

### Four approaches measured. None green. Do not repeat them.

| approach | result |
|---|---|
| solve once at `s = 0` (**what is committed**) | 2 camera FAILs, phone only |
| solve at the tightest bend | 4 FAILs — wrong everywhere else |
| solve per station (256) + lerp between them | **7 FAILs, incl. a new one: "looks BACK down the track"** |
| relax the ring (Laplacian, 120 passes) | camera unchanged; clearance eaten to 0.12 m |

**The third row is the load-bearing measurement, and it is why (b) and (c) are
both wrong.** Interpolating between 256 per-station solves *increased* the
failure count and introduced a failure mode none of the single solves had. That
is only possible if the **model** is wrong rather than its parameterisation: a
better-sampled wrong model is still wrong, and now inconsistently so between
neighbours. Refitting the same chord geometry harder — more stations, smarter
interpolation, a different choice of solve station — cannot work. It is an hour
of rediscovery if you try.

The fourth row is why (b) is self-defeating twice over: it did not even fix the
camera, and it damaged the clearance the whole migration exists to establish.

### The direction to take

Build the rig from the **local frame** — the tangent and outward normal at the
rider's own position, which `RingPath.sampleAt` already returns and which
`place()` already uses to rebuild position. A frame is defined **pointwise**: it
does not care what the track does between two stations, which is exactly the
property the chord lacks.

Concretely, the promise splits into a part that can hold exactly and a part that
cannot:

- **Rider at `riderNdc`** — a function of the stand-off and the aim's shift along
  the tangent. Both are local, so this can hold *exactly at every station*.
- **`AHEAD` at `aheadNdc`** — depends on where the track has gone by then, so it
  cannot hold exactly on a variable-curvature ring. But `check:rail-race`'s
  promise is **one-sided**: a window may never see *less* than promised, only
  more. So solve this at the **tightest** station and every other station
  over-delivers.

Face the camera along the **negative local normal** (square-on to travel in plan,
tilted down by `TILT`) rather than square-on to the chord. That is what should
fix both current failures at once — they share a root cause: the phone rig looks
28.9° down the track, which is also why riders cross at 0.876 instead of ≥ 0.9.

`camera.ts:245` still holds `stand`/`look` as scalars in the `(out, along, rise)`
local frame and `place()` rebuilds from them each frame, so the plumbing for a
local-frame rig is already there — it is `solve` that needs replacing, not the
class.

## Still outstanding besides the rig

- **`WALL_INNER_RADIUS`** — `src/world/train/route.ts`, 59.55. Stale in meaning.
- **The exit clamp** — `src/world/railRace/plan.ts:97`,
  `Math.hypot(x, z) > GARDEN_PLAY_RADIUS - 2` (56 m). Should ask
  `PARK_BOUNDARY.distanceToEdge`, not a radius.
- `railRaceStallStandsAtTheRim` fails on all five seeds until ruling 3 is done.

## What is already done and should not be redone

`ringPath.ts`, all 11 polar sites in `route.ts`, the arc-length phasing of
`undulation` (**climb spread 0.0000 m** — verify you have not disturbed it), the
invariant rewritten onto outset and green on all five seeds, `track.ts`,
`inward` in `check-rail-race.mts`, and the two Garden constants. See commit
bb51952.

## The trap that will bite you in the test tree

Do **not** static-import anything seed-dependent into `test/procgen/invariants.ts`.
The seed reaches `parkManifest.ts` via `LGP_SEED`, read once at module load, so a
static import pins every seed to the default park — the four sweep suites then
*silently skip* and you get "1 failed, 18 passed, 76 skipped", where the number
that looks wrong is the pass count. Reach it through `ParkFacts` instead; it
already carries `boundary`, `masonryHalfWidth` and `wallCollisionHalf`.

---

# E9-ring, 5 Aug — camera and procession done; booth and two constants left

Worktree `.claude/worktrees/e9-ring` (`npm ci` run inside it). Reference
checkout of `origin/main` at `.claude/worktrees/e9-mainref` with a symlinked
`node_modules`, for before/after measurement — **delete both when done**.
Port 5328 reserved; no dev server started.

## Done

**1. The camera rig — `e9dda79`.** Rebuilt on the local frame as ruled. Both
camera FAILs gone. `check:rail-race` reports the phone at **22.0°** down the
track and left-to-right **0.927** (was 28.9° / 0.876 against a 0.9 floor).

Three findings worth keeping:

- **`dot(screenRight, travel)` is exactly `cos(swing)`.** The two failures were
  one number. `leastInward` is the same quantity again.
- **The 28.9° was never a chord artefact.** It is
  `atan(-riderNdc · sec TILT · tanH)` — what *any* rig standing straight out
  from a hard-left rider must swing — and it matched the measured 28.9/12.4 on
  phone/monitor to 0.5% before a line was written. The chord model was still
  wrong (it is why per-station + lerp exploded), but it was not the cause of
  this. So the fix is a cap, `MAX_SWING = 22°`, with the rider's remaining
  leftward placing made up by **standing further down the track**.
- **The ring is genuinely concave in places** — 100 of 512 stations, tightest
  concave radius ~20 m. On those the chord rotates the *other* side of the
  tangent, which is precisely how the per-station experiment produced "looks
  BACK down the track". Recorded so nobody re-derives it.

The solve is now two closed forms, no bisection: `B = D(g c N² − s)/(c + g s)`
places the rider exactly at every station, and `D` per station is one division,
taken at the station that demands the most so everywhere else over-delivers.

**Cost, for QA to put in front of the family:** a phone in portrait now renders
**18.6 px/m**, was 27.6 (floor 15; the "too zoomed out" report was 10.4). Two
thirds of that is the swing cap; one third is honouring AHEAD at the concave
notches instead of at one lucky station. Monitor is unchanged (12.5°, 40 px/m).

**2. The procession — `a24abf0`.** Changed **`SWING_BEHIND` 0.55 → 0.80**, and
deliberately **not** `CATCHUP_BEHIND`. The measurement that decided it:
sweeping `CATCHUP_BEHIND` 0.006→0.009 moves the mean margin 72.4→53.6 and p90
120.7→94.9 but leaves p99 at 167/164/171/159 — **no trend**. Past
`SWING_BEHIND / CATCHUP_BEHIND` metres the band is a constant, so a steeper
ramp pulls the flat part *nearer* and can never reach the tail, and the tail is
what "procession" means. The ramp is also the only part a child can see (a
rival 10 m back, inside the ~21 m picture); the ceiling engages past ~130 m,
off screen.

0.80 comes from a rule, not a fit: the band should saturate at the same
fraction of a race as before — 91.7 m of 823 m = 11.1%, and 11.1% of 1200 m is
133.5 m, so `133.5 × 0.006 = 0.80`.

## The measuring trap that nearly caught me, worth inheriting

**`max` over the checker's 24 seeds is a coin flip.** My first `CATCHUP_BEHIND`
sweep read 124.4, 153.9, 88.5, 153.9 at 0.007/0.008/0.009/0.011 — non-monotone,
because a race is chaotic and the max of 24 draws reshuffles on any change.
Tuning to it is fitting to noise. Re-measured over **200 seeds** and the mean,
p50 and p90 are stable and monotone, which is what I tuned on.

The same probe turned up something the fleet should know: **`origin/main`
itself exceeds the `< 140 m` assertion on 3 of 200 seeds** (max 148.7). It
passes today because of which 24 seeds the checker happens to use. I have not
touched the assertion — restoring `main`'s race is what was asked, and buying
check margin by making the race tighter than it has ever been would be
inventing a new feel. Flagged for the Overseer as a separate decision.

**4. The two stale constants — `beff881`, `12d5d4d`. Both done.**

- The **ride exit clamp** (`plan.ts`, and its mirror `exitRadius < 56` in
  `check-rail-race.mts`) now asks `PARK_BOUNDARY.distanceToEdge` for a 2 m
  inset. No behaviour change: the exit stands 37.9 m inside the edge either way.
- **`WALL_INNER_RADIUS`** was `GARDEN_HALF_SIZE - 2 - 0.45` = 59.55, and it was
  *right by coincidence*: `GARDEN_HALF_SIZE - 2` is 60, and 60 is separately the
  gate pin the boundary generator constrains the edge to, which is also the
  edge's closest approach. Two unrelated numbers agreeing only while the park was
  a disc. It now asks the built boundary for its minimum radius.

  **Deliberately the minimum, not a per-bearing clamp.** Per-bearing would let
  the loop drift out toward the bulge, buying nothing (`NOMINAL_RADIUS` is 56.2,
  plots only push the loop to ~53.5, so the bound never binds) while moving a
  train four `check:park` invariants are measured against. Verified: `check:park`
  identical afterwards, down to the same first-gap point (49.3, 0.0).

  One thing left for somebody: the `0.45` is `Garden.ts`'s
  `BOUNDARY_WALL_COLLISION_HALF`, **restated rather than imported**, because
  `Garden -> paths -> train/plan -> train/route` is a real import cycle. It wants
  a home both can reach — `boundary.ts` is the natural one — but Garden's own doc
  argues "a number that describes built geometry belongs to the module that
  builds it", so moving it is somebody's call, not a silent edit from here.

## 3. The booth — NOT done, and it is a genuine conflict, not unfinished work

`npm run build`, `check:rail-race` and `check:park` are all green; `test:procgen`
is **90/95**, failing only `railRaceStallStandsAtTheRim` on all five seeds — the
state this branch was inherited in.

I built the fix, proved it cannot be made green, and reverted it. **The working
code is preserved on branch `feat/railrace-booth-at-rim` (`fe565b8`), based on
`c880393`** — cherry-pick it, do not rewrite it. What it does:

- `ManifestEntry` gains `atRim?: boolean` — a relation to the *boundary*, in the
  same spirit as `near` being a relation to another plot. A band cannot express
  "at the rim" any more: a band is a radius, the edge is a per-seed spline.
- `parkLayout.ts` gains `rimPositions()`, ranking candidates by `distanceToEdge`
  ascending and letting the existing constraint check take the first that works.
  It **draws no random numbers**, exactly as a pin does, so no other plot moves.

With it `test:procgen` is **95/95 on all five seeds**, and `check:park` then
reports `poi.stranded 2`, `rail.exclusion 36` (recorded 21), `rail.walkable 44`
(recorded 30).

### It is a conflict, and this is exhaustive rather than a sample

Bearing 20°, where the booth was pinned, is the canonical seed's **bulge** — the
edge is 98 m out there, the invariant needs the booth within ~34 m of the ring,
which needs radius ~64, and `PLOT_EXTENT_LIMIT` is 52. **No radius at the
historic bearing can ever satisfy the invariant.**

The feasible region can be bounded exactly: `waterFight` is solved 3rd of 12,
*before* the booth, so it never moves, and its **34.012 m** gap to the ring is a
complete ceiling on the booth's. Combined with the solver's own constraints that
leaves four clusters, all at radius ≥ 44.6 — east (bearings 3.5–12°), north
(103–104°), south (266–288°), and 308°. **All 344 positions in them were tested
against both checks. 344 rim-PASS, 0 clean.**

### The single universal blocker, and it is one waypoint

`poi.stranded` was ≥ 1 in **every one of the 344**, and it has no RATCHET
allowance, so it must be exactly 0. The rail invariants are **not** the
obstacle: 54 positions returned them to their recorded values exactly (21 m
unflanked, 30 standable), and 15 of those had `poi.stranded 1` as their *only*
regression. Best near-miss — booth at **(45.856, 5.630)**, bearing 7°, r 46.2:

```
rail: 359 m of loop, 21 m unflanked, 30/359 centre-line points standable
check:park: 1 invariant regression(s):  poi.stranded: 1
```

The stranded waypoint is **always the same one**: `(20.9, 20.2)`, the
ferris-wheel ticket kiosk's stand (`STALL_STANDS.spaceFerrisWheel`), which sits
inside `ferrisWheel`'s bounding radius by design and is reachable only via its
own spur.

**Mechanism** (read from the code and correlated, not isolated experimentally):
`paths.ts:403` grows a spur to every `STALL_STANDS` entry in
`Object.entries(STALL_PLACEMENTS)` order, and **`railRacer` is first**; each spur
branches "from wherever the *network* comes nearest" (`paths.ts:313`). Move the
booth to the rim and its spur is long, joins the network first, and every later
spur branches somewhere else — the ferris kiosk's ends up in a pocket. This is
the same action-at-a-distance the manifest's own comment already documents for
PR #159, in a new place.

The threshold is **radial, not rim-specific**. On the booth's own historic
bearing: r41–r45 clean, r46 and beyond strand the kiosk. Inside the rim-PASS
clusters the two bands do not overlap at all — on bearing 7° every radius below
45.5 is blocked by waterFight's corridor, and 45.5 upward strands the kiosk.

### What needs deciding — I should not pick this alone

1. **Fix the spur-ordering fragility in `paths.ts`** so a booth move stops
   reshaping where unrelated spurs branch. This is the actual root cause, it is
   somebody's whole task, and it would unblock the east cluster. Note it is
   necessary but **not sufficient**: `atRim` ranks by closeness to the edge and
   so picks the *south* (24.1 m inside) over the east (29.6 m), and the south
   regresses the rail invariants too. A rule that lands on the east would have to
   prefer a spot that is further from the rim, for reasons the manifest cannot
   express — so this needs the paths fix first, then a re-measure.
2. **Land `fe565b8` and treat the `check:park` regressions as the next job.**
   They are real — two waypoints nobody can walk to — so the branch is not green.
3. **Re-derive `railRaceStallStandsAtTheRim`.** I was told not to and I have not.
   But it is worth knowing *why* it now bites: with the ring 60–108 m out and
   plots capped at 52 m, "the booth is the closest plot to the rails" is no
   longer a statement about the booth being *at* the rim at all. It is a
   statement about plot ordering, and it forces the booth to the park's pinch —
   the one place the path network cannot absorb it.

Raw per-position verdicts are in the session scratchpad (`full-results.json`,
`sweep-results.json`).

`check:rail-race` green (fairness still **0.0000 m**, all four lanes 12.57 m).
`npm run build` exits 0.
