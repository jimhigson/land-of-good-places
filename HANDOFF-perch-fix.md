# HANDOFF — check:npc-perch on feat/sphere-combined

## Status: fixed, green. Running the full 65-step `check` for the ledger.

## Diagnosis (settled, with measurement)

`check:npc-perch FAILED — climbable tree 0 has no foliage to measure.` is a
**false alarm from the matcher**, not a canopy-less tree. The park is fine.

`canopyBandOf` matched a seed to its drawn foliage by plan distance
`hypot(dx, dz) < 0.05`. Measured on this branch's built park (canonical seed,
46 climbable trees, 77 occluders), decomposing each tree's nearest-occluder
offset against the tree's own outward bearing:

    worst TANGENTIAL offset over all 46 trees : 0.0000 m
    worst RADIAL    offset over all 46 trees  : 3.294 m   (tree 18)
    every tree's radial offset <= its own canopyHeight * sin(lean)
    tallest canopy above its own column        : 6.86 m

Every canopy sits on **exactly** its own tree's bearing and is displaced
**purely outward**, because `makeInstanced` -> `placeOnSphere` leans a canopy
that is metres above the ground outward by `height * sin(lean)`. A plan
distance is a flat measurement of a leaning world. Tree 0 was never
canopy-less; it was 1.97 m out along its own radial.

## The fix

`scripts/check-npc-perch.mts` taken **verbatim** from `5220305b` (PR #623,
merged on `eng/sphere-ground-claims`), which wrote exactly this matcher for
exactly this message. One copy, not two: the file is byte-identical to that
branch's, so when the branches meet there is nothing to reconcile.

It brings two things:
- bearing-decomposed match: tangential tolerance unchanged at 0.05 m (that is
  the axis that discriminates neighbouring trees); radial allowance
  `0.05 + tallestCanopy * sin(lean)`, outward only, plus a one-seed-one-canopy
  claim guard so a loosened radial cannot silently measure a neighbour.
- `drawnDropBelowHead` measured along the **local up**, not world +Y.

`tallestCanopy` is measured off this park (6.86 m here; 6.81 m on #623's
branch) and printed on every run, not hard-coded.

## Arm test — proved red on THIS branch's geometry

Clean run: exit 0.

1. `if (tangential < nearestTangential)` -> `if (true)` (the documented
   mutation; it is the line that decides *which* occluder is taken):
   `FAILED — trees 10 and 12 both matched the same foliage at (176.60, 10.42)`
   exit 1. (Geometry: canonical seed, 46 trees, tree 10 seed
   (98.06, 90.30) plan 133.31, tree 12 seed (173.39, 10.23) plan 173.69.)
2. `--mutate 1.2` (the player's lift leaking to NPCs): exit 1.
3. `--hide-body` (the retired head-only climb): exit 1.

Note per #623's own docblock: loosening the *radial* bound alone leaves the
check green, because nearest-tangential still picks each tree's own canopy.

## Not mine
128 procgen failures, coplanar seams, the seven #630 steps.
