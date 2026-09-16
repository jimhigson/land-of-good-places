# HANDOFF — seed 326 junctions on filleted corners

Model: Opus 5 (1M context), Overseer's dispatch (Engineer). Branch
`eng/seed326-square-junctions` -> `feat/sphere-combined` (rebased onto #652).

Ruling followed (Overseer): fix the router side, do not widen the invariant's 0.6 m.

Cause: the street lattice starts spurs on paved lattice nodes that are corners
of the paving route; `routeCurve` filleted every corner (1.75 m), so the drawn
ribbon passed 0.62 m inside the junction. Every pool seed had 3-16 such ends
(scratch instrument: route ends on another route's interior control vertex,
distance to its drawn curve).

Cure: `squareJunctionCorners` (paths.ts) marks corners another paved route
starts/ends on as `RouteDefinition.squareCorners`; `drawnPolyline` draws those
square (Decision 3: "square junctions otherwise"). Run inside `network()` and
before the graph returns.

Six-reds seed 326: router 28.4 m == invariant 28.4 m (was 157.5 m); no connector
needed (waste 18.9 < 25.8); detour invariant passes. Control: without the fix
the same probes print 28.4 vs 157.5.

Combined, pre-#652 base, by failing name on canonical/11/24/131/326/128/208/274/428:
only difference is the new invariant red->green on 7 seeds; 24, 131, 428 had no
red on it either side. Drawn hash changes on all 9 (visible, small); control
polylines change on 24, 131, 208; loops unchanged. After rebase onto #652: the
junction, path-end and detour invariants pass on 11, 131, 428.

New invariant `every spur starts on the drawn centre line of the path it
branches from` (0.25 m). Red on canonical base: 4 ends at 0.48-0.64 m.
