# HANDOFF — door-overlap

- Model: Claude Opus 5.5 (1M), assigned by the Overseer. Engineer. Branch fix/door-overlap off feat/structural-backtrack a4223efa; lead a52ae9484877226d6 merges.
- Jim: paving goes ~1 m under each building door, zero gap. One owner: core/constants DOOR_PAVING_OVERLAP.
- Done: doorApronOf returns front/to(=front+overlap in)/facing; pathGraph publishes `doorAllowances` (overlap per door + hotel recess) on path-surface userData; noDrawnPavingUnderASolid lets exactly those rectangles through (owner-based decorative skip removed); drawnPavingReachesEveryDoor asserts paving from each built door's drawn front to DOOR_PAVING_OVERLAP in.
- TODO: quick runs (clean + castle/booth controls), before/after frames of hotel and castle door, push, report.
