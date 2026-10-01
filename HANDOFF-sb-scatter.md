# HANDOFF: sb-scatter

Model: Claude Opus 5.5 (chosen by the structural-backtrack engineer). Branch fix/sb-scatter off origin/wip/sb-merge.

Task: scatterDecoupling 'leaves every tree, bush and wall away from the change exactly where it was' fails on seed 5.

## Root cause (measured)
Not the scatter. On seed 5 the rail-racer spur's arc-length-midpoint segment is a 36 m north-south street on
x = 23.28 (on the lattice). LGP_SPUR_STRETCH bows that whole segment into a shallow V (2 m over 36 m, 6.3 deg,
under the 0.15 hop-axis tolerance), which `offLatticeStreetRuns` reads as a 35.7 m street on x = 22.28, 1.00 m off
the lattice. The plan's legibility screen refuses pathGraph, unwinds train x5, then layout to decision zero (attempt 3,
cruiser fails, attempt 4) — the bowed digest is a *different park* (walls 27/28 vs 45/47, bushes 549 vs 461, 9 chains
vs 8). Every far change is a different layout, not scatter coupling. Traces: scratchpad sb-scatter/base.err, bow.err.

## Plan
1. Bow as a short tent (apex BOW sideways, half-width BOW along the segment: 45 deg sides) so the street run stays on its
   line and the plan accepts the bowed park unchanged.
2. Digest emits plan decisions; test asserts both parks' plan settled identically (else the comparison is vacuous/unfair).
3. Control: break tree candidateRng index-locking -> test must go red under the new perturbation.
