# HANDOFF — `pathsRunOnGridAxes` measures the route object, not the painted ground

Branch `fix/gridaxes-carrier`, worktree `.claude/worktrees/gridaxes-carrier`, off `origin/main`.

## Settling measurement — done, and it refutes the brief's hypothesis

The brief asked: *does the ballPit carrier's curve straighten at the node and split
the run below 16, while the other's does not?* **No. Neither carrier straightens.**
Measured on `origin/feat/grid-paths` @ `b8da4593`, seed 225, per-hop:

- `spur-building` arrives at the door along a diagonal at off-axis fraction ~0.32,
  but the hop `(37.86, 12.85) -> (38.35, 12.92)` measures **0.141** — a hair under
  the 0.15 threshold — so its run is flushed there. That carrier calls the lead two
  short approach runs, 1.32 m and 2.50 m.
- `connector-building-ballPit` starts at `(40.34, 13.58)` — same door, same lead —
  retraces that ground at 0.317…0.325 with **no dip at all**, and carries on to
  `(25.85, 7.06)` where the railway exemption takes over. One unbroken run:
  **15.89 m**.

Same park, same metres, two verdicts. The reported 16.2 m failure was the same
diagonal under an earlier build whose carrier ran 0.3 m further.

Same disease on `origin/main` seed 225 at the dodgems door: `spur-dodgems` calls
that lead a **3.49 m** run, `connector-dodgems-stall.dodgems` calls the same ground
a **2.98 m** run.

## The fix

`test/procgen/gridAxes.ts` — one owner for the measurement. Hop classification is
untouched (same `OFF_AXIS_FRACTION`, same railway exemption). What changed is the
*unit*: every edge's off-axis stretches are collected, stretches that are the same
painted ground are unioned, and each piece is measured by its own spread.

Same painted ground, asked **of points, never of ends**:

1. the two share a drawn sample (exact equality — a carving seam, or paving that is
   literally continuous);
2. some hop of one lies within `min(halfWidth)` of some hop of the other and the
   two run the same way there.

### Three wrong versions, each caught by measurement

- **Endpoint-based continuation** is itself observer-dependent: cutting a stretch
  makes new ends in its middle. Merged a 1.84 m and a 9.60 m stretch on the
  canonical seed *only after* the re-cut; red on 4 of 16 seeds.
- **No contiguity rule.** A stretch that curves hard (the spur into seed 225's
  building door turns 37 deg between consecutive hops) has halves no angle
  tolerance rejoins. Fixed by rule 1.
- **"Nearest point on the polyline"** reports the direction of whichever segment
  holds the closest point, and cutting can remove that segment from the piece being
  asked. Flipped the verdict across a re-cut on seed 451 at 22 deg and seed 208 at
  40 deg. Fixed by asking hop against hop.

### The tolerance is derived, not fitted

`PARALLEL_COS = cos(asin(OFF_AXIS_FRACTION))` = **8.63 deg** — the same direction
tolerance this check already owns, which already means "a difference this small is
curve sampling, not a difference in where the paving goes". Corroborated, not
chosen: swept over the sixteen-seed pool, **every** tolerance from 2 to 20 deg
gives the identical answer (nothing over 16 m, longest piece 13.69 m, cut-invariant
on every seed). At 25 deg the measurement begins fabricating failures; at 30 it
welds seed 24's junction dogleg into a 21.9 m "diagonal" whose real arms are 12.3 m
and 5.5 m.

**Cut-invariance now holds at every tolerance swept, 2 deg to 40 deg** — the
property is structural, not a value that happened to be safe.

## Results

**Sixteen-seed pool, `origin/main` geometry — violation set empty before and
after.** Longest piece of off-axis paving anywhere in the pool: **13.69 m**
against a limit of 16. No seed changes verdict; nothing was loosened.

**`feat/grid-paths` seed 225: the failure does NOT evaporate — it stops
flickering.** Measured on that branch's real park with the new module:

```
  TOP| 16.29 m (40.7, 13.7) -> (25.9, 7.1) :: connector-building-ballPit+spur-building
@@GP_OVER16 1
@@GP_RECUT_IDENTICAL true
```

The three numbers that branch has seen — 15.89 m (ballPit carrier), 16.2 m
(ginormousSlide carrier), 2.50 m (spur) — are three views of **one 16.29 m piece of
painted ground**. That is a genuine legibility defect on `feat/grid-paths`, not a
measurement artifact, and it is now reported the same way from any carrier.
`feat/grid-paths` must not claim this PR removed it.

`MAX_DIAGONAL_APPROACH` is untouched at 16.

## Proofs

`test/procgen/gridAxes.test.ts` — five, all on real geometry pasted into the file
with the seed and commit it was read off:

- **red** on the seed 225 lead: 16.29 m, over the limit, from both carriers;
- **green, and cut-invariant**: one answer across **257 carvings** of that same
  paving — every single cut of either ribbon, every piece count to 8, every overlap
  to 6, and 200 ragged carvings;
- retraced ground is not double-counted (10 m stays 10 m);
- ordinary grid paving says nothing;
- seed 24's junction dogleg is not welded.

Mutation-proved red (each restores clean afterwards):

| mutation | red |
|---|---|
| merging disabled | 3 of 5 |
| continuation without collinearity (pre-rewrite) | dogleg test |
| overlap rule disabled | 2 of 5 |

`gridAxisVerdictsIgnoreTheCarrier` is registered in `INVARIANTS`, so the property
is asserted on every seed on every run, and announces its coverage to `stderr`.

## Status

- [x] settling measurement
- [x] fix
- [x] both-sided proof, cut-invariance proved directly
- [x] tolerance derived + sensitivity swept
- [x] grid-paths seed 225 verified
- [x] gates: `check` 0, `test:procgen` 0 (525 tests), `build` 0,
      `check:coplanar` 0, `typecheck:test` 0 — all read unpiped
- [x] PR #484 raised. **Not merged** — awaiting review + QA.

## Review round 1 (#484) — changes requested, both edits made

1. **`samePaintedGround`'s docstring denied a real weld.** "Running the same way
   keeps a crossing from qualifying" is true of **rule 2 only**; rule 1 (shared
   drawn sample) has no direction clause and welds at any angle. Confirmed by my
   own measurement, not taken on trust: nine rule-1-only welds across the pool at
   **17.0-83.6 deg**, worst inflation **0.44 m** (seed 225), tightest headroom
   **3.64 m** (seed 288, 12.36 m against 16). No verdict turns on it today.
   Docstring rewritten to state the bound; fixture added pinning the 90-degree
   case at **14.00 m**, labelled "Pinned, not endorsed".
   **It cannot be fixed with a collinearity clause** — the seed 225 spur turns
   37 deg across a seam, so any test that rejects a right angle tears it in two.

2. **The tolerance derivation was overstated.** `OFF_AXIS_FRACTION` bounds one
   hop's deviation, so two ribbons on the same line can differ by ~17.3 deg; it
   does not imply 8.63. Comment now says chosen-by-plateau, not derived.

**Both disputed numbers settled by measurement (round 2).** Population quoted
everywhere is now **seventeen seeds**: `PARK_SEED_POOL` plus seed 18, the only
seed the invariant suite runs that the pool does not contain.

1. **Headroom — the review is right, and its definition is better. Adopted.**
   My 3.64 m was the welded *pair's* extent (seed 288, 12.36 m). The review
   measured the **component**, which is what actually gets compared against
   `MAX_DIAGONAL_APPROACH`: 13.69 m on seeds 11 and 288, giving exactly
   **2.31 m**. Reproduced to the digit.
2. **Plateau top edge — my 22 deg stands; 25 is not reproducible.** Half-degree
   sweep over all seventeen seeds: empty at 22, seed 5's 16.8 m piece appears at
   **22.5**. 29-30 deg is where the *seed 24 dogleg* welds, which is what the
   30 deg figure refers to. Seed 18 did not move the edge.
3. **Rule 1's real cost is better than either figure: 0.00 m.** Re-running every
   seed with rule 1 restricted to welds that also pass rule 2's angle test
   leaves the largest piece **identical to two decimals on every seed**. Its
   welds all sit inside pieces something else already bounds, so the 0.44 m
   pair-level inflation never reaches the piece being tested. I could not
   reproduce 0.70 m under any definition and said so rather than splitting the
   difference.

**My seed-18 hypothesis was refuted**, not confirmed: seed 18 adds one weld
(75.5 deg, +0.25 m per-pair, 13.92 m headroom), neither the worst pair nor the
tightest piece. The gap was a difference of *definition*, not of population.

**Dominance argument (from the review, re-verified on 16 seeds not 5):** old
measured the chord between a run's first and last sample; this measures the
diameter of the same set, and union only adds points. `diameter >= chord`, so
the new measure dominates and cannot swallow a violation. Instrumented both:
`newMax == oldMax` **exactly on all sixteen seeds**, never less.

Seed 225 **is** a pool seed and passes `vet:seeds --list 225` on this branch
(PASS, 83 invariants, exit 0).

`check:park-boot` contention filed as a comment on existing **#456**, not a new
issue: <https://github.com/jimhigson/land-of-good-places/issues/456#issuecomment-5527823672>

## Note for whoever picks this up

`check:park-boot` failed once at 76.4 ms against its 21.9 ms ceiling while three
vitest jobs ran in parallel; idle it reports 12.3 ms and passes. Its calibration
loop measures single-thread speed and cannot see contention. Not this branch's
diff (`test/` only) and not fixed here — recorded in the PR as an observation.
