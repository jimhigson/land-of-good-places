# Handoff: seed 131 tree on the railway (#653)

Branch `eng/seed131-tree-rail`, off `origin/eng/sphere-six-reds` (PR #650).

## Finding (measured, seed 131, tree nearest the rail)
- foot (flat, = trunk collider) (-86.18, 28.73); drawn canopy centre (-87.79, 29.26); slide 1.69 m
- foot -> rail centreline 5.40 m; scatter gate `onRailway` needs 2.6+2.6 = 5.2 -> gate honoured, on the foot, vs TRAIN_PLAN.route (== world.train.route, drawn via placeOnSphere)
- canopy reach about the foot, flat parts: 2.25 m -> real gap 3.14 m >= TRACK_CLEARANCE 1.3
- invariant was reading `parkFacts` TreeFact: centre = drawn x/z, footprint = flat parts minus drawn centre (3.94 m): mixed frame, slide counted twice -> -0.20
- Tree is NOT on the rail. The fact was wrong, not the scatter. No src change, so no RNG shift.

## Fix
TreeFact x/z = footX/footZ, footprint about the foot (test/procgen/parkFacts.ts).
Same fact feeds tree-tree, tree-wall, bush-tree, entrance invariants: check their names before/after.

## Result (all five pool seeds, failing test NAMES)
- origin/eng/sphere-six-reds locally: 68 failing names, identical to PR #650 CI run 35102671110 (sha 50f7b172).
- this branch: 54, a strict subset. 14 go green, 0 new:
  railway (131, canonical); tree-tree and bush-tree (all 5); tree-wall (131, canonical).
- Control: loosening Scenery's rail/tree-tree/tree-wall/bush-tree gates (then reverted) turns all four red on 131 with real numbers.
- No src/ change -> scatter RNG and placements byte-identical by construction.
- typecheck:test exit 0. Status: PR open against eng/sphere-six-reds.
