# HANDOFF — triage of the 51 `Procgen invariants` failures on `feat/sphere-combined`

**Model: Opus 5 (1M context)**, Engineer. A replacement runs the same model.
Branch `fix/sphere-procgen-triage` off `origin/feat/sphere-combined` @ 5c322a5b.
Worktree `.claude/worktrees/sphere-procgen-triage`. No browser, no dev server.

Source list: CI run 35120529727 (head 5c322a5b) — `51 failed | 628 passed (679)`, 0 skipped.
Local canonical run reproduces the canonical subset exactly (17 s per seed file).

## The 51, by test name (x seeds)

| test | seeds |
|---|---|
| park gate arch stands over its gateway | 5 |
| Rail Race duck bar stands over a real trestle leg | 5 |
| Rail Race duck bar slows you down where it stands | 5 |
| every support meets the track it carries | 5 |
| Rail Race trestle forks twice and carries all four tracks | 5 |
| Rail Race sleepers bridge both rails | 5 |
| every racer meets the same number of duck bars | 5 |
| Sky Cruiser stands on its own supports | 5 |
| both Rail Race rings stand outside the park | 5 |
| slide does not clip the castle towers | 24, 326 |
| every modelled coping stone sits on the wall it caps | 11, 326 |
| slide clears the garden on the castle roof | 131 |
| no drawn path ends in mid-air on a bridge | canonical |

## Status: STOPPED 16 Sep on the Overseer's order (sphere work paused for the procgen rewrite)

No invariant was changed. No PR opened. What is on the branch:

- `src/world/terrain.ts` gains `unplaceFromSphere(drawn)` — the exact inverse of
  `placeOnSphere` (drawn point -> flat authoring-frame point: foot on the ray from
  the planet centre, height = radius difference). Invisible: nothing in the game
  calls it yet. It is the instrument most of the clusters below need.
- `test/geo/core.test.ts`: round trip over `SAMPLE_COLUMNS` x heights 0/1.4/9/25 m,
  **worst 8.99e-14 m**; control: a point drawn 9 m up at (90, 40) read straight as
  flat is > 3 m out. 38/38 pass.

## Triage so far — MEASURED vs HYPOTHESIS is marked on every row

Classes (Overseer's scope change): 1 = instrument/geometry fault (survives the
rewrite, worth fixing); 2 = old-generator decision (record, do not fix); 3 = unclear.

### Cluster A — drawn (leant) geometry measured against flat plans. 40 of 51. Class 1 (instrument), HYPOTHESIS strongly supported by code reading; per-test measurement NOT yet done.

Root: `1bbd1dd2`/`80249d35` (13 Sep) made the Rail Race draw every rail, trestle
node and duck bar leant along the local up (`route.pointAt` = `flatPointAt` +
`placeOnSphere`; route.ts's own doc: "about 3.7 m further out ... not an error").
Coaster pylons were leant the same way (`Coaster.ts`, strut foot -> `placeOnSphere`'d
top). The invariants still read the built meshes' world `x, z` (and world `y`,
world-`+Y` angles) and compare them to flat things: `boundary.distanceToEdge`,
`coaster.route.nearestPoint` (flat route), `forkPlan(beamY - foot.y)` with angles
from world `+Y`, nearest-lane by XZ. The lean is `height * sin(tilt)`; at r ~ 60-110 m
on R = 220 and 8-18 m ride heights that is 2-5 m — the size of every reported miss.

| test (x5 seeds) | reported | why it fits the lean |
|---|---|---|
| Sky Cruiser stands on its own supports | pylon top 2.46-3.56 m from route | top is leant, `route.nearestPoint` is flat. Game code leans the top onto the drawn track on purpose. |
| every support meets the track it carries | same pylons, 2.46-3.52 m | same comparison (the Rail Race half of this test passes). |
| both Rail Race rings stand outside the park | outer rail 13.2-14.4 / 16.2-17.5 m out vs 12; ratio 1.81-2.01 vs 2.5 | raw vertex XZ vs flat boundary; the taller race ring leans further, so outset inflates and the ratio is distorted. |
| every racer meets the same number of duck bars | 0/10/10/20 on race ring | bar sits `duckClearance` above its rail, so leans further out than the rails and snaps to the outer lanes by XZ. `railCentreLinesByLane` also drops y *before* `matrixWorld`. |
| duck bar slows you down where it stands | bonks 2-15 m from bars; two bars share one bonk | `parkFacts.ts` assigns lane by leant bar XZ vs `raceRoute.pointAt`, so other lanes' bars are simulated for PLAYER lane. |
| duck bar stands over a real trestle leg | 8.0-13.2 m vs 8 m, race ring only | bar (high) and leg instance centre (mid-height) lean by different amounts. |
| trestle forks twice and carries all four tracks | 3 of 4 lanes; fork angle 62-146 deg off plan | angles from world `+Y` and `beamY` from world y; branch tops assigned to lanes by leant XZ. |
| Rail Race sleepers bridge both rails | 0.53-0.57 m off rail, walk-past ring | nearest-lane/rail in XZ. UNCLEAR whether pure lean: sleeper and rail are at the same height, so lean should mostly cancel — measure before assuming (possible real sleeper-orientation bug -> class 3). |

**Next step for whoever resumes**: in each of these, pass every read-back world
point through `unplaceFromSphere` (strut ends individually, both sleeper gauge
points, rail vertices) and compare with the flat plan. Rows that go green are
class 1; residuals are real. Then prove red per check (e.g. pylon top not leant
-> must fail by ~h sin tilt). Whatever the rewrite builds will be measured by
these same checks, so the instrument fix survives it.

### Cluster B — park gate arch (5 seeds). Class 3 (unclear), NOT measured.
"rays cast up through the opening hit no part of the arch". Likely rays cast along
world `+Y` from plumb points while the arch leans (gate is at the boundary,
tilt ~15-30 deg), i.e. class 1 — but the arch could also be genuinely displaced.
Not investigated.

### Cluster C — slide clips `tower-roofs[3]` (24, 326), roof garden (131). Class 3, NOT measured.
Brief's lead (reviewer on seed 24: planner's towers upright, castle leant, 3.6 m
sideways / 2 m vertical) not yet checked against `CASTLE_FRAME` from #650. If the
slide planner does not ask `CASTLE_FRAME`, it is a geometry-owner fault (class 1)
even though it lives in a generator. Roof garden: "roof tops out 8.06, chute
underside 7.84" — check whether both are radial or one is world y (the #625 mix).

### Cluster D — coping stones (11 bridge-304.0, 326 bridge-2.0). Class 3, NOT measured.
Worst 0.031 m above seat, 1-2 blocks of 98. Small; could be a plumb `COPING_SINK`
on a leaning parapet (class 1) or a bridge-builder placement (class 2).

### Cluster E — `spur-station-0` ends 0.63 m up on a bridge (canonical only). Class 2 likely, NOT measured.
0.63 vs a 0.62 step-up — 1 cm over. A path/bridge placement decision of the old
generator, unless the 0.63 is a world-y height (then class 1). Check `altitudeAt`.

## History (measured, from CI logs)
All 13 test names were already red at 039e6e00 (run 35108030983, 79 failed);
#650 fixed the other 28 and introduced none of these.
