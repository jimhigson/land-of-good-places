# HANDOFF — check:npc-perch on feat/sphere-combined

Model: Opus 5 (1M context), chosen by the Overseer. Branch: `eng/perch-matcher-sphere`.
Scratch worktree for the six-reds comparison: `.claude/worktrees/perch-sixreds` (detached, clean).

## The question in the failure message, answered

**The check was picking the wrong tree. The park has NOT planted a
canopy-less climbable tree.** Measured on the built park, canonical seed,
46 climbable trees / 77 foliage occluders, decomposing each tree's
nearest-occluder offset against that tree's own outward bearing:

    worst TANGENTIAL offset over all 46 trees : 0.0000 m
    worst RADIAL    offset over all 46 trees  : 3.294 m  (tree 18)

Every canopy is on *exactly* its own tree's bearing, displaced purely
outward — `placeOnSphere` leans a canopy that is metres above the ground
outward by `height * sin(lean)`. Tree 0's foliage was 1.97 m out along its
own radial, against a 0.05 m tolerance. No child could find a climbable
tree without a canopy.

## Superseded: do NOT ship the bearing matcher

My first commit brought #623's bearing-based matcher across from
`eng/sphere-ground-claims`. **The Overseer has ruled against it** and the
ruling is right: `eng/sphere-six-reds` adds `FoliageOccluder.footX/footZ`
to `Scenery.ts` as the **one owner** of "where does this tree stand", and a
bearing matcher inside a check script would be a second definition of that
same fact.

## Measured verdict on eng/sphere-six-reds (b59b3a28)

1. **`check:npc-perch` still FAILS there with no check-side change** —
   same message, `climbable tree 0 has no foliage to measure`, exit 1.
   The `Scenery.ts` fix alone is not sufficient, because the check still
   reads `candidate.x/.z` (the **drawn** canopy centre) rather than the
   new `footX/footZ`.

2. **Asking the one owner fixes the match completely.** Changing
   `Math.hypot(candidate.x - tree.x, candidate.z - tree.z)` to
   `Math.hypot(candidate.footX - tree.x, candidate.footZ - tree.z)`:

       matching on footX/footZ : worst distance 0.000000 m, 0 of 46 outside 0.05 m
       matching on drawn x/z   : worst distance 3.2942 m
       distinct occluders claimed: 46 of 46 trees

   That is two words, no new maths, no new tolerance, no second definition.

3. **A SECOND, separate defect is then exposed** (this is the residue the
   Overseer predicted). With the matcher honest, the check's height clause
   fires: `a climbing NPC's head is 3.21 m *below* the leaves of tree 41`.

## The residue, diagnosed: the height clause is a world-Y difference

`clearance = headY - band.top` — two world `y` values — and `band.top` is
`part.position.y + part.scale.y` off the **drawn, radially-slid** canopy.
That is an altitude difference standing in for a distance, on a leaning
world. Measured both ways, same run, on `eng/sphere-six-reds`:

    tree  plan     worldY clearance   altitude clearance
      29   14.2         -0.003            -0.030
       8   44.4         -0.279            -0.228
       0  118.7         -0.889            -0.105
      18  170.2         -1.907            +0.395
      12  173.7         -2.552            +1.520
      45  179.2         -1.856            +0.599
      41  185.8         -3.208            +2.989

At plan 14 m (no lean) the two agree to 0.03 m. The divergence grows
monotonically with plan radius and at tree 41 the two have **opposite
signs**. So the check's "3.21 m buried in the leaves" is not trustworthy,
and the clause cannot answer its own question on a sphere as written.

I did **not** fix this — it is a separate question, it belongs with the
`TreeClimbing`/sphere lane, and it needs a frame-correct definition of
"the topmost leaf" as well as of the head.

## Third defect, for the record

With combined's `TreeClimbing.ts` + the footX matcher, the height clause
passes and the **body** clause fails instead:
`drawn only 0.64 m below its own head at tree 45 (needs 0.9 m)`.
`drawnDropBelowHead` measures along world +Y, so a leaning child reads
short by `1/cos(lean)` — 0.64 m instead of 1.10 m at tree 45's 54.5 deg.
#623 fixed this on `eng/sphere-ground-claims`. Also not mine.

## Summary: three stacked defects, one per layer

| # | defect | owner |
|---|---|---|
| 1 | matcher reads drawn canopy centre, not the foot | `Scenery.footX/footZ` (six-reds) + 2 words in the check |
| 2 | `drawnDropBelowHead` measures along world +Y | check script; fixed on `eng/sphere-ground-claims` |
| 3 | height clause is a world-Y difference | check script; UNFIXED, separate question |

## The ledger
`/tmp/.../scratchpad/ledger.txt` and `steps/*.log`. Measured on
`feat/sphere-combined` + a local perch unblock (steps 20-65 are unaffected
by which perch fix is used).
