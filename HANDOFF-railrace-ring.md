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
