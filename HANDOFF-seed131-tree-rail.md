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
