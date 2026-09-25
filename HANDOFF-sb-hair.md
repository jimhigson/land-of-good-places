# HANDOFF: sb-hair (model: Claude Opus 5.5, chosen by the structural-backtrack engineer)

Task: the new check:coplanar finding on wip/sb-merge, seed 9:
`garden|railRace/railRace:cart/kid/.../hair.shell.crop|railRace/railRace:cart/kid/body/torso`,
area 0.000184 m2, separation 8.45 mm, normal (0.377,-0.310,0.873), at (99.967,-21.147,68.480),
occluded=true, reach=null.

## Finding: it is not one child's hair against her own torso

The key names both objects by a path that is identical for all three rival
riders, so it cannot say which kid each came from. Measured on the built seed-9
park (nearest triangle to the overlap point, per kid):

- kid1 (Nell, bob) torso: 8.01 mm, tri 255, normal (0.378,-0.313,0.871) — same as the finding
- kid2 (Otto, short/crop) hair.shell.crop: 13.94 mm (nearest tri), the other face of the pair
- kid1's own hair is bob, not crop; kid0's crop is 834 mm away

So it is **Otto's crop hair against Nell's torso — two children in neighbouring
carts**. Their head centres are 1.345 m apart; a child is 1.53 m across at the
hair (WIDEST footprint doc in kid.ts), lanes are 1.10 m apart
(LANE_SPACING_AT_PARK_SCALE = CART_WIDTH_AT_PARK_SCALE). Neighbouring riders'
heads interpenetrate: seed 9, 22 of Nell's skull vertices are inside Otto's
crop and 11 of Otto's crop vertices inside Nell's skull; seed 0 shows the same
kind of overlap (9 bob vertices inside kid2's skull, heads 1.347 m apart).
Seed 9 only differs in that Nell's torso happens to graze Otto's hair plane.

## The kid model itself is clean

Lone kid, every one of the 10 hair styles, turned through 84 orientations (so
the camera-facing filter hides nothing), at scale 1 and 2.5: **0 coplanar pairs
of any kind**. Control: a copy of the crop shell 4 mm off the original -> 80025
pairs found, so the instrument can see one.

Deleting a hair face would therefore fix nothing and damage every child's hair.
No code changed on this branch. Probe scripts are in the sb-hair scratchpad
(_probe-*.mts); they ran from scripts/ for the import paths.

## The real fix is a rail-race layout decision (not taken here)

Options: stagger the rivals along the track so no two sit abreast in the
static layout; or widen lane pitch beyond one cart (CART_WIDTH is a documented
ceiling: 1.12 fails raceCameraNeverRunsBackwards on seed 5). Both visible; for
the caller / Jim.
