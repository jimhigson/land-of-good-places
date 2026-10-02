# HANDOFF — door-overlap

- Model: Claude Opus 5.5 (1M), assigned by the Overseer. Engineer. Branch fix/door-overlap off feat/structural-backtrack a4223efa; lead a52ae9484877226d6 merges.
- Jim: paving goes ~1 m under each building door, zero gap. One owner: core/constants DOOR_PAVING_OVERLAP.
- Done: doorApronOf returns front/to(=front+overlap in)/facing; pathGraph publishes `doorAllowances` (overlap per door + hotel recess) on path-surface userData; noDrawnPavingUnderASolid lets exactly those rectangles through (owner-based decorative skip removed); drawnPavingReachesEveryDoor asserts paving from each built door's drawn front to DOOR_PAVING_OVERLAP in.
- Quick checks (seed 12 r0): clean PASS both (allowances let through: hotel overlap 3.24 m², hotel recess 27.36 m², castle overlap 3.78 m²); castle control red 1.62 m² under castle wall; booth control red 6.12 m²; overlap control (CTRL_HOTEL_OVERLAP=1, paving-gap.mts) red 'stops 0.00 m in under the door'.
- Frames (scratchpad frames/door-{before,after}-s12-{hotel,castle}.png): castle gap of lawn at the foot of the steps closed; hotel looks identical (already met the doors; overlap hidden under them).
- Skipped locally: accept sweep, procgen diff, check:park, coplanar, determinism (CI).
