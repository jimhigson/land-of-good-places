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
- [ ] gates (`check`, `test:procgen`, `build`) — running
- [ ] PR
