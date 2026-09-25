# HANDOFF sb-map (model: Claude Opus 5.5, chosen by the structural-backtrack engineer)

Task: `check:park-map` BLANK MAP on seed 2 (2.8% at zoom 4 NE, square) and seed 0 (0.0% NW).

Root cause: `clampMapView` kept the visible window inside the park's *bounding box*
(+6 m margin, grown to the bus stop). The park is a lobed spline, so the box has
empty corners; the window could sit almost wholly in one.

Fix (src/ui/parkMapProjection.ts): the view centre is projected exactly onto
`box ∩ park outline` (`PARK_BOUNDARY.outline()`, the polygon ParkMap draws).
Identity on allowed centres (re-clamp drift ~1e-14 m), drag slides along the edge,
zoom 1 unchanged (box collapses to the framed centre).

Status: fix committed+pushed on fix/sb-map. Remaining: all-16 run, red proof.
Scratch sweep script `scripts/_sbmap-sweep.mts` is NOT to be committed.
