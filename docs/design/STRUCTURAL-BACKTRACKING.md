# Structural backtracking: no park ships that fails a measure

**Design and audit, 24 September 2026.** Jim: *"there should be no 'fail some
placement checks' GUARANTEED STRUCTURALLY because ALL FEATURES SHOULD BE
BACKTRACKABLE — this means that even in the case of total failure,
backtracking to zero will work, effectively starting again."* And later the
same day: every seed must build, not only the shipped 0..15; the guarantee
must not rely on which seeds are shipped.

## The mechanism, in three rungs

1. **At the point of decision.** Each builder's `advance` refuses a candidate
   that breaks a constraint it owns, against the claims/collision world as it
   stands, and the round-robin driver (`src/boot/parkSolve.ts`) climbs its
   ladder: retry, accommodate, forgo (optional increments only), unwind,
   decision zero. This existed before this work; the audit below says, per
   measure, whether the owning builder already refuses.
2. **Owned failures on the finished park.** Some measures can only be taken
   on the built `World` (a simulated ride, a raycast under a bridge, a flood
   fill over every collider). Where one names a single owning feature, the
   plan is to move the measure into that owner's `advance` so it refuses
   there; until it is moved, rung 3 catches it.
3. **The root rule: start again from zero.** `scripts/lib/acceptedPark.mts`
   builds restart `r = 0, 1, 2, …` of a seed, each in a fresh process
   (`scripts/park-attempt.mts`), and asks every acceptance measure. The first
   restart with no complaint is the park. Restart `r` draws every seeded
   choice — boundary, layout, every ride, every tree — from
   `generationSeed(seed, r)` (`src/world/parkRestart.ts`), so it is a wholly
   independent park under the same identity. Restart 0 is the seed's own park,
   unchanged, so a seed that passes first time is the park it always was.

**So a park the solver returns passes every measure by construction**: it is
the first attempt that did. What forced every restart is logged per attempt
(`describeRestarts`), for the prebuilt park file's metadata.

### One owner per measure

The acceptance measures are the invariants themselves and `check:park`'s keys,
not copies:

- `PARK_ACCEPTANCE` (`test/procgen/invariants.ts`): the furnished floors (the
  former `expect`s in the registration, now the invariant `theParkIsFurnished`)
  followed by every entry of `INVARIANTS`. `registerParkInvariants` asserts the
  same list; the loop asks it.
- `measureParkFindings` (`scripts/lib/parkFindings.mts`): `check:park`'s whole
  measurement, moved out of the script's top level into a function.
  `scripts/check-park.mts` is now a printer over it; the loop asks it with the
  ratchet enforced.

These stay under `test/` and `scripts/` rather than moving into `src/`. They
import the headless harness and three.js scene readers that the game bundle
must never ship, and the only askers are Node processes, so one owner is kept
without inverting `src → scripts` imports.

A measure that **throws** is an instrument bug, not a failed park: the attempt
is marked `broken` and the loop stops, because a restart cannot fix it and
searching around it would hide it. A **build** that throws (a solver
exhausted) is a failed park and gets a restart.

### Termination

Each restart is an independent draw from the parks the generator makes. If a
fraction `p` of those pass every measure, the attempts a seed needs are
geometric with mean `1/p`: finite for any seed whenever `p > 0`. `p` is
measured, not assumed (`pnpm run accept:parks -- <seeds>`). `MAX_RESTARTS`
(200) is a bug-catcher like the driver's `MAX_UNWINDS`: hitting it throws the
whole log.

**What restarts must never be used for**: a measure that fails because of a
geometry or instrument bug fails on some fraction of every park. A search
would route around it by rejecting the parks where it shows, and ship the bug
in the others. So every "geometry" row below that fails on any seed is fixed
at its cause. It is never left for the loop.

## Audit

### Summary

"Already-checked" means the owning builder or search refuses a violating candidate **before it commits**.

| set | yes | partial | no | geometry (not a decision) | other |
|---|---|---|---|---|---|
| 99 invariants | 26 | 35 | 9 | 28 | 1 (#6: runtime arrival behaviour) |
| 12 check:park keys | 2 | 4 | 1 | 4 | 1 (K5 `poi.split`: dead key, never emitted) |
| 6 furnished floors | 2 | 0 | 4 | 0 | 0 |

Context the rows assume:
- **Everything is already enforced at the root, but only by restarting the whole park.** On HEAD e5d8c8ec, `PARK_ACCEPTANCE` (invariants.ts:~11999) includes `theParkIsFurnished` (the floors, now an invariant at :11704) and every invariant. `scripts/lib/acceptedPark.mts` restarts the whole park from zero while any of them complains. So "no" and "partial" mean no *local* refusal. They do not mean nothing is enforced.
- check:park keys are emitted in `scripts/lib/parkFindings.mts`, not in `check-park.mts` itself, which calls `measureParkFindings` at :84. `poi.split` appears in `HARD_KEYS` (:937) but no `report()` call emits it, so it can never fail.
- **Decided in the World constructor with no builder, so they cannot refuse back to a search:**
  - real bridge footprints: `bridges.ts:633` throws
  - Sky Cruiser pylons: `planCruiserPylons`, Coaster.ts:564
  - slide legs: `planSlideLegs`, Building.ts:967
  - slide cameras: `planSlideShots`, Building.ts:954
  - the Sky Cruiser castle-window envelope: Coaster.ts:185, a console warning only
  - Sky Cruiser tree felling: Scenery.ts ~425-490, which lowers the tree count after the trees builder has said `done`
- **Builders that end with `done` however little they placed:** trees, bushes, lamps (`forgone` slots, LampPosts.ts:611-619), fairyLights. Nothing refuses on a low count, which is why #1, #36 and F1-F4 are "no".

### Invariants

| # | invariant name | function (invariants.ts:line) | owner | already-checked | how solver-side |
|---|---|---|---|---|---|
| 1 | every scattered feature actually puts something in the park | everyScatteredFeaturePlacesSomething (invariants.ts:11435) | walls/trees/bushes/lamps/fairyLights builders (Scenery.ts:949, :669, :842; LampPosts.ts:562; FairyLights.ts:451) | no: no builder refuses on reaching 'done' with zero committed (or poles with zero strings); only per-item refusals | each builder's advance() could refuse at 'done' when its out list is empty (fairyLights: when no two adjacent poles strung) |
| 2 | the ground is the sphere it claims to be, and the park fits on it | theGroundIsTheSphereItClaimsToBe (invariants.ts:10665) | geometry (not a decision): terrainHeight src/world/terrain.ts:16, GROUND_SPHERE_RADIUS core/constants.ts:86; boundary size generateParkBoundary boundary.ts:666 | n/a (geometry) | clause 1 is constant geometry; clause 2 (drawn reach under the equator) only measurable on finished World (drawnReach) |
| 3 | the road's corridor claim is the road it drew | theRoadsCorridorIsTheRoadItDrew (invariants.ts:10945) | geometry (not a decision): entranceRoadClaims roadCorridor.ts:223 built from entranceRoadSegments :179; ribbons drawn by Entrance.ts | n/a (geometry; road builder never refuses, just claims) | only measurable on finished World (compares registry to drawn ribbons) |
| 4 | every stall is drawn, claimed and solid in the same place, and its counter still works | stallsAreDrawnClaimedAndSolidTogether (invariants.ts:11528) | stallBuilder stallsFeature.ts:213 (claims from one claimsFor :158) | partial: accepts() (:231) checks body clear, stand point and straight walk (:267) only on relocation (:370); advance() commits layout spot on claims.blockers alone | stallBuilder.advance could run accepts() on the initial spot too; drawn==claimed==solid consistency only on finished World |
| 5 | every castle corner turret is solid | castleTurretsAreSolid (invariants.ts:11115) | geometry (not a decision): registerCastleTowerCollision building/Building.ts:2806 | n/a (geometry) | only measurable on finished World (collision probes) |
| 6 | the arrival reaches its end and hands over | theArrivalReachesItsEnd (invariants.ts:10464) | not a placement: runtime sequencing in JourneyDirector entrance/journeyDirector.ts:43 (readyToHandOver :249) | n/a (runtime behaviour, not a decision) | only measurable by running the arrival (parkFacts.ts:3439 runTheArrival) |
| 7 | every Rail Race support is claimed exactly as it is drawn | railRaceSupportsAreClaimedAsDrawn (invariants.ts:11227) | railRace builder, trestleSpots railRace/track.ts:1865 | yes: lean refused track.ts:1946 (maxTrunkLean), claims from trestleClaims :1959 checked by groundClaims.blockers :1960, TrestleRefusal :1991 | already in railRace builder; claimed==drawn equality only measurable on finished World |
| 8 | the road's corridor claim covers the whole run the bus drives | theRoadClaimCoversTheBusRun (invariants.ts:11365) | road step: entranceRoadSegments roadCorridor.ts:179 (kerb stations, clipped at boundary) vs entranceBusArriveAt/VanishAt | no: road claims never refuse; nothing compares the bus run to the claim before commit | road step in plan phase could assert bus-run samples inside entranceRoadClaims (all pure functions, no World needed) |
| 9 | the ginormous slide clears the garden on the castle roof | theSlideClearsTheCastleRoofGarden (invariants.ts:4998) | slideSearch slide/solve.ts:1818 (roof garden itself: building/Shell.ts:1446) | no: solver only knows battlements via fixed BATTLEMENT_AIR (solve.ts:269, startY :284); roof garden/pavilion height unknown to it | slideSearch could test chute samples over the castle roof box against a roof-garden top exported from Shell |
| 10 | nothing stands in the journey lane carriageway | nothingStandsInTheLanesCarriageway (invariants.ts:10518) | BusJourney lane scatter entrance/BusJourney.ts (verge :1362, park-ahead :1540 with PARK_AHEAD_CLEAR :271) | yes (by construction): x offset = ROAD_HALF_WIDTH or PARK_AHEAD_CLEAR plus each thing's reach | not a park builder; only measurable on the built journey scene |
| 11 | nothing grows in the lane but the park's own trees | nothingGrowsInTheLaneButTheParksOwnTrees (invariants.ts:10576) | geometry (not a decision): which populations BusJourney.ts builds (rollTree :1300) | n/a (geometry/code identity) | only measurable on the built journey scene |
| 12 | no two tap targets crowd each other or a doorway | tapTargetsKeepTheirDistance (invariants.ts:10401) | stallBuilder stallsFeature.ts:213, planStations train/plan.ts:288, Flowers scatter | partial: flowers keep out via insideAnyTapKeepOut Flowers.ts:616; stallBuilder accepts() and station planning do no tap-spacing check vs each other or door bands | stallBuilder accepts could check tapSpacing vs committed stalls, platforms and castle/hotel door bands; full zone list only on finished World |
| 13 | the park really is twice the park | parkAreaIsWhatWasAsked (invariants.ts:10307) | geometry (not a decision): closed-form generateParkBoundary boundary.ts:666 | n/a (geometry) | constant construction; checkable at boundary generation, no search involved |
| 14 | every plot stands wholly inside the boundary | plotsStayInsideTheBoundary (invariants.ts:10323) | layout, layoutRestartSearch parkLayout.ts:343 | yes: validate refuses edgeGap < BOUNDARY_CLEARANCE (2.5 m, parkManifest.ts:140) at parkLayout.ts:1042-1043 | already in layout validate per candidate |
| 15 | the attractions use the whole park | attractionsUseTheWholePark (invariants.ts:10345) | layout, layoutRestartSearch parkLayout.ts:343 | no: only a maximin spread heuristic (parkLayout.ts:144); nothing refuses a layout with a desolate (>=66 m) quarter | layout builder could compute worst desolate distance after last plot and restart |
| 16 | the Land Hotel stands close to the castle | hotelIsCloseToTheCastle (invariants.ts:10375) | layout: hotel's near relation parkManifest.ts:230 | yes (by construction): drawCandidate places it 28-42 m from building (parkLayout.ts:995-999), under the 45 m bound | already in layout candidate draw |
| 17 | no two wall runs cross or crowd each other | wallsDoNotClash (invariants.ts:366) | walls: wallPlan Scenery.ts:~1613, committed by wallBuilder :949 | yes: fitsAmong/runsClash with WALL_RUN_GAP=2 m (Scenery.ts:1574-1582, used :2022, :2042) exceeds WALKABLE_GAP 1.24 | already in wallPlan candidate generation |
| 18 | no wall run stands on the railway | wallsClearTheRailway (invariants.ts:386) | walls: wallPlan / runIsClear Scenery.ts:1551 | yes: runIsClear refuses isPlantable(3.2)->onRailway, distanceToRailCorridor < RAIL_CORRIDOR_CLEARANCE, bridge footprint (Scenery.ts:1561-1563) | already in wallPlan candidate generation |
| 19 | every wall run sits on a grid axis and actually borders something | wallsBorderTheGridSensibly (invariants.ts:456) | walls: generateWallMaze/generateStoneRuns Scenery.ts:1965, :2032 | partial: axis by construction from pathBorderSegments axisYaw (Scenery.ts:1762, :1992, :2099); proximity only "anywhere along" via runHugsPaving :1840, not every point within 14 m | wallPlan could refuse runs whose furthest sample exceeds the path/plot proximity bound |
| 20 | every wall run goes alongside a path, and some stand flush against one | wallsRunAlongsideAPath (invariants.ts:568) | walls: wallPlan Scenery.ts:1634-1635 (runHugsPaving filter) | partial: runHugsPaving :1840 enforces closest <= wallAlongsideMax; flush floor (>=4 runs) not enforced, verge drawn from range incl. 0 (:1908, :2055) | wallBuilder could count flush runs at 'done' and refuse below FLUSH_RUNS_FLOOR |
| 21 | no tree stands on the railway | treesClearTheRailway (invariants.ts:654) | trees: treeBuilder Scenery.ts:669 | partial: isPlantable(2.6)->onRailway fence 2.6+2.6 m (Scenery.ts:758, :786, :1376) is a fixed margin, not the rolled canopy footprint measured | treeBuilder accept() could test distanceToRail minus rolled footprint against TRACK_CLEARANCE |
| 22 | no flower grows on the railway | flowersClearTheRailway (invariants.ts:4231) | Flowers scatter (World-built, not a builder): world/Flowers.ts:626 | yes: clearOfRailway(x, z, WIDEST_FLOWER) refuses the spawn point (Flowers.ts:626) | not a builder; the World-phase scatter already refuses it |
| 23 | no entrance prop stands on the railway | entrancePropsClearTheRailway (invariants.ts:722) | Entrance findWelcomeSignSpot entrance/Entrance.ts:177 | yes: skips spots with clearance < WELCOME_SIGN_MIN_TRACK_CLEARANCE (Entrance.ts:198, const :120) | pure function of TRAIN_PLAN; could run in plan phase after train, already a search |
| 24 | the train runs through no plot and no stall | trainClearsEveryPlotAndStall (invariants.ts:4182) | train: trainRouteSearch train/route.ts:672 | yes: trainObstacles at boundingRadius + TRACK_PLOT_CLEARANCE (route.ts:198-215) fed to the brief's clear predicate (:645) | already in train route search |
| 25 | the park train keeps its turning circle | trainKeepsItsTurningCircle (invariants.ts:4139) | train: trainRouteSearch train/route.ts:672 (brief minRadius :649) | yes: rail/generate.ts:820 refuses a segment with minCurvatureRadius < brief.minRadius (TRAIN_MIN_TURN_RADIUS=10) | already in train route search |
| 26 | no two plots overlap | plotsDoNotOverlap (invariants.ts:774) | layout (layoutRestartSearch, src/world/parkLayout.ts:343; validate() parkLayout.ts:1018) | yes: validate refuses `crowds '<id>'` when bounding-circle gap < CORRIDOR_GAP (parkLayout.ts:1071-1074); near pair exempt, as in invariant | layout builder, per candidate in buildOnce (parkLayout.ts:891) — already done |
| 27 | no two stations stand in each other | stationsDoNotCrowdEachOther (invariants.ts:7882) | train (planStations src/world/train/plan.ts:288, clearStationDistance) | partial: only a soft `crowding` score penalty (plan.ts:207-220) against STATION_SEPARATION (plan.ts:286); nothing refuses a crowded pair | train builder after planStations (parkPlan.ts:396) could refuse when any stand gap < STATION_SEPARATION |
| 28 | every entrance has standable ground | entrancesAreUsable (invariants.ts:1128) | layout (anchor doormats) + stalls (stall stand zones, stallBuilder src/world/stallsFeature.ts:213) | partial: layout doormatRefusalsSearch refuses stranded/no-spot doormats (parkLayout.ts:472-573); stalls claim stand as `walkable` (stallsFeature.ts:163) and check it on a move (stallsFeature.ts:262); final collision not re-probed | layout doormat probe + stalls advance; isStandable on the final collision world only measurable on finished World |
| 29 | the park gate arch stands over its gateway, and the gateway stays open | theParkGateArchStandsOverItsGateway (invariants.ts:909) | geometry (not a decision): buildGateArch yaw/piers src/world/entrance/gateArch.ts:152-176, placed at fixed ENTRANCE_GATE_X/Z src/world/entrance/Entrance.ts:281-295 | n/a(geometry) | only measurable on finished World (mesh box, colliders, headroom rays) |
| 30 | no two trees interpenetrate | treesDoNotInterpenetrate (invariants.ts:1176) | trees (treeBuilder src/world/Scenery.ts:669) | yes: accept() refuses centre gap < TREE_REACH[a]+TREE_REACH[b] (Scenery.ts:704), TREE_REACH is the per-kind canopy ceiling (src/world/treeModel.ts:129) | trees builder accept(), already done |
| 31 | no bush stands on the paving or inside a plot | bushesStandOnOpenGround (invariants.ts:1156) | bushes (bushBuilder src/world/Scenery.ts:842) | yes: accept() calls isPlantable(x,z,BUSH_REACH=2.15) (Scenery.ts:853) which refuses isOnPath and insideAnyAnchor(boundingRadius+margin+2.5) (Scenery.ts:1349,1351,1532) | bushes builder accept(), already done |
| 32 | no tree grows into a wall | treesKeepOffWalls (invariants.ts:1211) | trees (treeBuilder Scenery.ts:669; walls placed first, deps ['walls']) | yes: clearOfWalls(x,z,reach,TREE_WALL_GAP=1.44 >= invariant 1.24) (Scenery.ts:706, 1665-1677) | trees builder accept(), already done |
| 33 | no bush grows through a wall or out of a tree | bushesGrowThroughNothing (invariants.ts:1260) | bushes (bushBuilder Scenery.ts:842); trees on relocation | yes: bush accept refuses clearOfWalls(BUSH_COLLIDER) and tree reach+BUSH_COLLIDER (Scenery.ts:857,859); moved tree refuses bushes (Scenery.ts:712) | bushes/trees builder accept(), already done |
| 34 | every path passes near a tree a child can climb | everyPathIsNearAClimbableTree (invariants.ts:2632) | trees (treeBuilder 'cover' phase, Scenery.ts:769-792, CLIMB_COVER_TARGET Scenery.ts:680) | partial: cover phase tries 60 plants per uncovered cell then silently moves on (Scenery.ts:779-792); no refusal; tree relocation can drop cover | trees builder at 'done' could measure path-edge distance to climbable trees and refuse |
| 35 | no lamp stands in anything | lampsTouchNothing (invariants.ts:1300) | lamps (lampBuilder src/world/LampPosts.ts:562, lampFits LampPosts.ts:652) | yes: lampFits refuses plots (LampPosts.ts:679), rail corridor 4.2 m (LampPosts.ts:697), walls (~LampPosts.ts:724-736), other lamps LAMP_GAP (LampPosts.ts:738) | lamps builder lampFits, already done |
| 36 | every path is lit end to end | everyPathIsLit (invariants.ts:2559) | lamps (lampBuilder LampPosts.ts:562; slots lampSlots LampPosts.ts:512) | no: a slot with no spot is pushed 'forgone' or refused as optional (LampPosts.ts:611-618); nothing measures dark runs | lamps builder at 'done' could walk path routes against LAMP_REACH/MAX_DARK_RUN and refuse |
| 37 | no paved path stops anywhere but a destination | noPathEndsNowhere (invariants.ts:1467) | pathGraph (pathGraphSearch src/world/paths.ts:3903) | no: supply 1, no internal refusal; parkPlan screens (parkPlan.ts:458-520) test boundary/crossings/pinch only; ends correct by construction | pathGraph builder after pathGraphSearch (parkPlan.ts:450) on graph edges/nodes |
| 38 | every spur starts on the drawn centre line of the path it branches from | everySpurStartsOnTheDrawnCentreLine (invariants.ts:1542) | pathGraph (pathGraphSearch paths.ts:3903) | no: no screen on ring-junction ends; by construction only | pathGraph builder screen after pathGraphSearch (parkPlan.ts:450) |
| 39 | every plot faces exactly the camera axis | buildingsFaceTheCameraAxis (invariants.ts:1599) | geometry (not a decision): signYaw = CAMERA_FACING_YAW constant in buildOnce, src/world/parkLayout.ts:~938 | n/a(geometry) | trivially true at layout commit; no decision can vary it |
| 40 | every paved path runs on grid axes | pathsRunOnGridAxes (invariants.ts:1706) | pathGraph (pathGraphSearch paths.ts:3903; router legs paths.ts:558-715) | partial: router prefers axis legs but falls back to a direct diagonal leg with no refusal (paths.ts:670) | pathGraph builder screen on drawn ribbons (like parkPlan.ts:458 screens); railway exemption needs bridges/route (plan-known) |
| 41 | the grid verdict does not depend on which route object carries the paving | gridAxisVerdictsIgnoreTheCarrier (invariants.ts:1735) | geometry (not a decision): self-consistency of the test's offAxisGround/recutCarriers instrument, test/procgen/invariants.ts (gridAxes helpers) | n/a(geometry) | not a park decision; instrument property only |
| 42 | every street sits on the shared 12 m lattice | streetsShareLatticeLines (invariants.ts:1855) | pathGraph (streetLatticeSearch paths.ts:2162, STREET_PITCH) | partial: streets built on lattice nodes by construction (paths.ts:2176-2180); fallback router for ground the lattice cannot serve (paths.ts:1517) is not refused | pathGraph builder screen after pathGraphSearch |
| 43 | the ring road is one true circle round the statue | ringIsATrueCircleRoundTheStatue (invariants.ts:2122) | geometry (not a decision): ring sampled at PLAZA +/- RING_RADIUS, src/world/paths.ts:320-345 | n/a(geometry) | no decision can vary it |
| 44 | every place a child can be served is a node in the path graph | everyDestinationIsANode (invariants.ts:2169) | pathGraph (nodes from layout entrances) + stalls (world-phase stand shift, stallsFeature.ts:104 STALL_SHIFT_REACH 1.5) | partial: stall moves capped at 1.5 m and must walk straight from spur end (stallsFeature.ts:262-266), but no node-distance (ARRIVAL 1.24 m) test | stalls builder advance/accommodate could test stand vs pathGraph nodes; plan-side by construction |
| 45 | no two close destinations are left with a wildly disproportionate paved detour | detourRatiosStayReasonable (invariants.ts:2482) | pathGraph (addInterconnects, paths.ts:4329; escape paths.ts:4783) | partial: addInterconnects adds connectors for disproportionate pairs, but a connector that cannot route is not refused | pathGraph builder after pathGraphSearch (graph distances available at plan time) |
| 46 | every ride exit is clear ground, reachable from the entrance | rideExitsAreUsable (invariants.ts:1335) | exit planners (planExit src/world/coaster/solve.ts:99; railRace/plan.ts:127; slide) + world features avoiding onRideExit (Scenery.ts:1295) | partial: planners screen plots/edge/rail; trees/bushes/lamps avoid exits (Scenery.ts:1353, LampPosts.ts:712); exits not `walkable` claims, reachability unchecked by any builder | clear-ground via a walkable claim per exit in GroundClaims; reachability only measurable on finished World (NavGrid) |
| 47 | the Rail Race exit fits the whole party that arrives on it | railRaceExitFitsTheParty (invariants.ts:1402) | Rail Race exit plan (planRailRace, src/world/railRace/plan.ts:127-161) | no: exit screened for plots/rail/edge only (plan.ts:141-147), not for room for laneCount bodies; falls back silently (plan.ts:156) | only measurable on finished World (resolveDismountGroup over final collision) |
| 48 | the Rail Race flies clear of the railway and stands on clear ground | railRaceFliesClear (invariants.ts:2693) | railRace (railRaceBuilder worldPhase.ts:126; slot search src/world/railRace/track.ts) | partial: legs refused near rail corridor/paths/plots via legacyRefuser (track.ts:1741-1749) and claims; no widest-leg-gap test (unscheduled slots may go), air-over-rail is ring geometry | railRace builder slot search could measure leg gaps; air over rail on ring geometry at plan |
| 49 | every Rail Race duck bar stands over a real trestle leg | duckBarsStandOnRealSupports (invariants.ts:3497) | railRace (trestle slot search, src/world/railRace/track.ts ~1850-1995) | yes: a duck-bar slot with no supportable spot throws TrestleRefusal (track.ts:355, 1991) | railRace builder, already done |
| 50 | every Rail Race duck bar slows you down where it stands | duckBarsSlowYouWhereTheyStand (invariants.ts:3731) | geometry (not a decision): bar drawn at its scored DuckBar.at, src/world/railRace/track.ts:888 and hazards.ts:527 | n/a(geometry) | only measurable on finished World (simulated ride) |
| 51 | the Rail Race finish rainbow clears every rider | finishRainbowClearsEveryRider (invariants.ts:3611) | geometry (not a decision): arch radius solved from rider head height + ARCH_HEADROOM and lane span, arch.ts:52-76 / buildArch track.ts:2074-2084 | n/a(geometry) | only measurable on finished World (formula; could be asserted as a pure function of the planned ring) |
| 52 | the Rail Race finish rainbow stands on the ground | finishRainbowStandsOnTheGround (invariants.ts:3676) | railRace plan: slideArchClear route.ts:765 picks startDistance; legs to terrain are geometry track.ts:2135-2150; paths kept off via archFoot blockers paths.ts:251 | partial: slideArchClear refuses doormat/plots/exit/cruiser loop (route.ts:780-787, plan.ts:187-199); pathGraph routes round feet; no railway-corridor check found | plan-time: RailRaceRoute construction (slideArchClear) could add the rail corridor once train is planned; path gap owned by pathGraph |
| 53 | every support meets the track it carries | supportsMeetWhatTheyCarry (invariants.ts:9155) | geometry (not a decision): trestle branch tops/sleepers from trestleTreeAt/forkPlan track.ts:1596, trestleGeometry.ts:154, sleepers track.ts:443-500; cruiser pylons to route in Coaster.ts:564 | n/a(geometry) | only measurable on finished World (mesh construction) |
| 54 | every Rail Race trestle forks twice and carries all four tracks | railRaceTrestlesCarryEveryTrack (invariants.ts:9517) | geometry (not a decision): forkPlan trestleGeometry.ts:154, trestleStruts track.ts:1415 | n/a(geometry) | only measurable on finished World |
| 55 | the Rail Race sleepers bridge both rails, a metre apart | railRaceSleepersBridgeBothRails (invariants.ts:9718) | geometry (not a decision): sleeper loop track.ts:443-500 (SLEEPER_SPACING, sleeperDrop) | n/a(geometry) | only measurable on finished World |
| 56 | every racer meets the same number of duck bars, and no two bars touch | duckBarsAreOnePerLaneAndNeverTouch (invariants.ts:9862) | planHazards hazards.ts:442 (one bar per lane per event, unique slots via snapToTrestleGrid hazards.ts:406); road loss via trestleSpots overRoad track.ts:1902-1922 | partial: unique-slot rule hazards.ts:406, bar slot with no support throws TrestleRefusal track.ts:1991; but fallback reuses a slot hazards.ts:424 instead of refusing | plan-time pure function of loop length for race ring; walk-past road loss needs railRace builder (road claims) |
| 57 | the Sky Cruiser stands on its own supports | skyCruiserStandsOnItsOwnSupports (invariants.ts:10095) | planCruiserPylons pylons.ts:185, run in Coaster ctor Coaster.ts:564 (no builder); gaps depend on cruiserRouteSearch route | partial: gap-fill backtrack pylons.ts:~300-340 but an unfillable gap is accepted silently; route search never asks about supports (solve.ts:250) | needs paths+scatter: a World-phase pylon builder over GroundClaims, refusing back to cruiser; today only on finished World |
| 58 | the Rail Race camera never runs backwards | raceCameraNeverRunsBackwards (invariants.ts:9348) | RaceCamera camera.ts:557 (zoom ceiling measureZoomCeiling camera.ts:992) over ring shape RING_PATH route.ts:165 (boundary-derived) | no: no refusal found; camera tuned, ring not re-chosen | plan-time: layout builder could probe RaceCamera on RAIL_RACE_PLAN.raceRing (pure function of boundary) |
| 59 | both Rail Race rings stand outside the park, built to their own size, and only the walk-past one is solid | railRaceRingsStandOutsideThePark (invariants.ts:3263) | geometry (not a decision): ring at NOMINAL_OUTSET dimensions.ts:78 via RingPath route.ts:165; per-ring scale build; walk-past colliders addPostCollider track.ts:1092-1099,1707 | n/a(geometry) | only measurable on finished World |
| 60 | every Rail Race post is solid all the way up a child | everyPostIsSolidAllTheWayUpAChild (invariants.ts:3183) | geometry (not a decision): addPostCollider track.ts:1707, called track.ts:1099 along drawn post | n/a(geometry) | only measurable on finished World (collider vs drawn lean) |
| 61 | the rail-race stall's doormat is standable and reachable | railRaceStallDoormatIsUsable (invariants.ts:3848) | layout (stall plot) + pathGraph pathGraphSearch paths.ts:3903; train loop pocketing | partial: train route loopLeavesEveryDestinationOnTheCrossing train/route.ts:447,532; pathGraph pinch/off-site screens parkPlan.ts:486-515; no nav-lattice reachability in search | only measurable on finished World (nav lattice over final collision); pathGraph could approximate via graph connectivity |
| 62 | every doormat in the park can be walked to from the gate | everyDoormatIsReachableFromTheGate (invariants.ts:1361) | train loop (trainRouteSearch) + crossings + pathGraph; final blockers from all world builders | partial: train/route.ts:447 (destinations left on crossing side), parkPlan.ts:505-515 pinch rule, off-site crossing screen parkPlan.ts:486; no end-to-end reachability refusal | only measurable on finished World; a post-worldPhase nav flood could refuse back to walls/stalls |
| 63 | every keychain keyring's stand point is standable and reachable | keychainStallStandIsUsable (invariants.ts:3915) | KeychainShop keyring stand offsets KeychainShop.ts:1057-1073 (geometry) + layout/pathGraph for reachability | partial: same as #62 for reach; stand offsets vs cart collider not checked by any builder | only measurable on finished World (shop collider + nav lattice) |
| 64 | the Sky Cruiser flies clear of the whole park | skyCruiserFliesClearOfThePark (invariants.ts:4004) | cruiserRouteSearch (tall obstacles/castle, route.ts:959-985) + world scatter builders (trees/bushes/walls/lamps/fairyLights) | partial: clearOfCruiser refuses trees Scenery.ts:715, bushes :854, walls :1568, lamps LampPosts.ts:707, fairy poles FairyLights.ts:551; no full-triangle sweep | only measurable on finished World (ray sweep of all meshes, coaster/clearance.ts) |
| 65 | the Sky Cruiser goes round the big wheel | skyCruiserGoesRoundTheBigWheel (invariants.ts:4017) | cruiser (cruiserRouteSearch route.ts:1142; tallObstacles route.ts:259) | yes: clear() refuses corridor within ferris wheel radius route.ts:971-983 | cruiser builder already does (plan-time) |
| 66 | the Sky Cruiser built track turns as gently as it promises | skyCruiserTurnsGently (invariants.ts:4092) | cruiser: pieces solved at PLAN_TURN_RADIUS route.ts:177/1029, rebuilt as CatmullRom in CoasterRoute | partial: plan held to 13 m with margin; built curve not re-measured before commit | finishCruiserPlanSearch (solve.ts:250) could measure the built CoasterRoute and refuse |
| 67 | the ginormous slide goes downhill all the way, lands in the ball pit, and never runs back inside the castle | theGinormousSlideIsRideable (invariants.ts:4307) | slide (slideSearch solve.ts:1818) | yes: underground solve.ts:2080, re-entry insideCastle solve.ts:937, plots solve.ts:951-958, route ends at pitPoses solve.ts:1107 | slide builder already does |
| 68 | the ginormous slide never climbs, measured against the local up | theGinormousSlideNeverClimbs (invariants.ts:4442) | slide: heightAt radius profile solve.ts:1223 | yes (by construction: monotone radius, solve.ts:1203-1229); no explicit refusal | slide builder could assert on chutePoints before commit |
| 69 | the ginormous slide stands on legs a child can walk between | theGinormousSlideStandsOnSomething (invariants.ts:4525) | planSlideLegs supports.ts:133, run in Building ctor Building.ts:967 (no builder) | partial: walkable gap refused supports.ts:204; too few legs just skipped, no backtrack | World-phase leg builder over GroundClaims could refuse back to slide; today only on finished World |
| 70 | the ginormous slide leaves the castle over the top of the battlements | theGinormousSlideLeavesOverTheBattlements (invariants.ts:4689) | slide: lip height startRadiusFor solve.ts:337 over CASTLE_MASONRY_TOP (solve.ts:257), doorFitsTheWall solve.ts:1336 | partial: battlement clearance by construction; roof-garden clearance not asked (no roof garden in solve.ts) | slide builder could add roof-garden top to chuteComplaint |
| 71 | the ginormous slide does not clip the castle towers | theGinormousSlideMissesTheCastleTowers (invariants.ts:5086) | slide (slideSearch solve.ts:1818) | yes: clearsTowers in chuteMayPass solve.ts:940 and chuteComplaint solve.ts:2090 | slide builder already does |
| 72 | the ginormous slide's cameras cover the whole ride and can see it | theSlideTracksideCamerasCanSeeTheRide (invariants.ts:5236) | planSlideShots cameras.ts:629, run in Building ctor Building.ts:954 | partial: occlusion only vs the chute itself cameras.ts:607, falls back to least-bad eye cameras.ts:615; no ground-air check found | only measurable on finished World (occlusion by whole scene) |
| 73 | a child boarding the ginormous slide is put down on the chute | theSlideRiderSitsOnTheChute (invariants.ts:5416) | geometry (not a decision): SlideRide.pointAt SlideRide.ts:288 vs drawn chute frame | n/a(geometry) | only measurable on finished World |
| 74 | a child finishing the ginormous slide lands in the balls, clear of the chute | theSlideRiderLandsInTheBalls (invariants.ts:5563) | slideLandingSpot landing.ts:122 (LANDING_RUN_ON landing.ts:87) from slide mouth pose | partial: clampToPit keeps her in pit landing.ts:145; chute clearance (riderClearanceFromChute landing.ts:170) not asked by slideSearch | slide builder could evaluate landing clearance on the solved route |
| 75 | about half the ginormous slide's chute is see-through | theChuteIsHalfSeeThrough (invariants.ts:5483) | geometry (not a decision): BAND_PERIOD/BAND_CLEAR_FRACTION SlideRide.ts:108-117, band test SlideRide.ts:506 | n/a(geometry) | only measurable on finished World |
| 76 | the ginormous slide keeps its air from the Sky Cruiser | theSlideKeepsItsAirFromTheCruiser (5693) | slide (slideSearch, src/world/slide/solve.ts:1818) | yes: chuteComplaintSearch refuses <CRUISER_AIR 5.5 m within CRUISER_OVERLAP 2.2 m (wider than invariant's 1.86 m band), slide/solve.ts:2054; legs via cruiserCrossesColumn :737. Measures plan chute vs plan cruiser, invariant measures built | slide builder's solve already evaluates it (plan chute vs COASTER_PLANS cruiser route) |
| 77 | the Sky Cruiser fits through the window it cut in the castle | skyCruiserFitsThroughTheCastle (5392) | cruiser (cruiserRouteSearch, src/world/coaster/route.ts:1142); window cut from built curve in coaster/castleWindows.ts:320 | partial: plan-space castleClear crossing-band rule route.ts:985; the swept-envelope checks (checkCastleWindows/sweptCartHits) run only on the built curve, Coaster.ts:185 merely console.warns | finishCruiserPlanSearch could run checkCastleWindows on the built CatmullRom (route.ts:1583) before commit; sweptCartHits needs built castle mesh (finished World) |
| 78 | the Sky Cruiser always flies through the castle | skyCruiserAlwaysFliesThroughTheCastle (5757) | cruiser (cruiserRouteSearch, src/world/coaster/route.ts:1142) | yes: `satisfies: crossesTheCastle` route.ts:1047/352 plus escalated re-solve ~1051 (plan-space span; built span re-derived at route.ts:1425). Until fix/sb-cruiser-castle the ladder shipped the search's unsatisfied fallback loop (seed 3 r3: escalated tier, 267 m, satisfied=false) — now `cruiserRouteSearch` throws and the builder refuses | cruiser builder: refuses on a missed plan, and on a null built `castleSpan` (parkPlan.ts cruiserBuilder) |
| 79 | the clearance over the railway covers the train and everyone riding it | railwayClearanceCoversTheTrainAndItsRiders (5862) | geometry (not a decision): TRAIN_CLEARANCE_Y src/world/train/clearance.ts:107, BRIDGE_RISE :177, kid/hat models, bridge soffit in bridges.ts | n/a(geometry) | only measurable on finished World (model/constant dimensions) |
| 80 | every railway crossing has a bridge you can walk to, onto and across | everyBridgeIsWalkableAndReachable (6547) | crossings (crossingSitesSearch, train/crossingPlanSolve.ts:460) + real bridge footprint search planReal (train/bridgeFootprint.ts:765, run in World ctor via bridges.ts:617) | partial: fitBridgeAcross walkable-ramp proof crossingPlanSolve.ts:288; planReal realClear/playBounds/gateway :788 and shift/ramp refusal :1069-1108; no nav-reachability-from-entrance check anywhere | reachability/standability only measurable on finished World (nav lattice + collision); planReal is late and throws (bridges.ts:633) rather than backtracking |
| 81 | nothing a bridge builds hangs into its own tunnel, measured by ray from the rail | nothingHangsIntoTheTunnel (6079) | geometry (not a decision): bridge stonework src/world/train/bridgeStonework.ts, buildOneBridge bridges.ts:659 | n/a(geometry) | only measurable on finished World |
| 82 | every modelled coping stone sits on the wall it caps | everyCopingStoneSitsOnItsWall (6189) | geometry (not a decision): buildCopingRun src/world/train/bridgeStonework.ts:364 | n/a(geometry) | only measurable on finished World |
| 83 | no bridge parapet can be seen through — its outer face reaches the wall top | noBridgeParapetCanBeSeenThrough (6379) | geometry (not a decision): buildShellGeometry src/world/train/bridges.ts:1209, parapetHeightFor :221 | n/a(geometry) | only measurable on finished World |
| 84 | every bridge is as wide as its own path, with the rail corridor open beneath | bridgesMatchTheirPathAndKeepTheRailClear (7301) | bridge footprint planReal (train/bridgeFootprint.ts:765; width bridgeRoadHalfFor :293/:995) + bridges.ts buildOneBridge :659 | partial: width derived from pathHalfWidth by construction (:995), ramps kept off rail corridor (:1033); nothing refuses on built standable width or stone-over-rail clearance | only measurable on finished World (collision.resolve + raycast of built bridge group) |
| 85 | the park's own paving rides over every bridge, and none is left in a tunnel | theDrawnPathRidesOverEveryBridge (7487) | geometry (not a decision): drapePathsOverBridges src/world/pathGraph.ts:353, called World.ts:192 with bridgePavingHeightAt bridges.ts:592 | n/a(geometry) | only measurable on finished World (mesh vertex buffers) |
| 86 | every bridge's carried paving has its own masonry under it | bridgePavingIsCarriedByItsOwnMasonry (7681) | geometry (not a decision): paving lift bridges.ts:592 vs masonry halfAcross bridgeFootprint.ts:995 | n/a(geometry) | only measurable on finished World |
| 87 | railway crossings are planned — station-clear, and mostly real bridges | crossingsArePlannedAndWalkable (7914) | crossings (crossingSitesSearch, train/crossingPlanSolve.ts:460) | yes: stationBlocked refuses sites in STATION_GAP window crossingPlanSolve.ts:184/279; zero sites throws ~:480; bridges.ts:633 throws on no bridge | crossings builder (plan phase, stations already solved by train builder) |
| 88 | every crossing on a site the planner proved bridgeable still carries its bridge | everyProvenBridgeSiteKeepsItsBridge (8194) | pathGraph (pathGraphSearch paths.ts:3903 + off-site screen parkPlan.ts:489) for on-site; bridge fit is bridgeFootprint planReal (World ctor) | partial: parkPlan.ts:489 refuses off-site drawn crossings; crossings.ts:371 throws; bridges.ts:633 throws if real search finds no bridge (no backtrack) | on-site half in pathGraph builder; deck-exists half only in World ctor (planReal needs real collision) |
| 89 | no drawn path ends in mid-air on a bridge | noDrawnPathEndsStrandedOnABridge (7770) | pathGraph (pathGraphSearch, src/world/paths.ts:3903) | partial: stub nodes on bridges refused paths.ts:2615; segments cutting masonry refused :1904/:2231; uses planned site extents, not built footprint | pathGraph builder could test route ends against planned bridge footprints; exact height only on finished World |
| 90 | no bridge stands where the crossing planner proved none fits | noBridgeStandsWhereNoneWasProven (8319) | pathGraph (off-site screen parkPlan.ts:489) + crossings.ts computeCrossings snapping | yes: screenDrawnPathsForOffSiteCrossings refusal parkPlan.ts:489 (crossingPredicate.ts:176); crossings.ts:371 throws on unsnapped crossing | pathGraph builder already |
| 91 | the walk in from the gate crosses the railway where the planner planned it to, on a bridge | theWalkInFromTheGateCrossesWhereItWasPlannedTo (8004) | pathGraph (pathGraphSearch paths.ts:3903; gate-approach ribbon) | partial: off-site screen incl. esplanade parkPlan.ts:489 covers clause 1; deck-present clause relies on bridges.ts:633 throw in World ctor | clause 1 in pathGraph builder; clause 2 only on finished World |
| 92 | the cat bus is actually in the park, at the gate, with everyone aboard | theCatBusIsInThePark (8685) | geometry (not a decision): ArrivalSequence src/world/entrance/ArrivalSequence.ts:1338 wiring, catBus.ts model | n/a(geometry) | only measurable on finished World |
| 93 | every child fits in the cat bus seat they are sitting in | childrenFitTheSeatsTheySitIn (8653) | geometry (not a decision): seat plan src/world/entrance/catBus.ts:79-148, CHILD_FOOTPRINT src/art/models/kid.ts:304 | n/a(geometry) | only measurable on finished World (model dimensions) |
| 94 | the boundary wall has a gate you can actually walk through | theGateIsAHoleInTheWall (8370) | geometry (not a decision): boundary blocks filtered by outsideTheGate src/world/Garden.ts:184/376 (isInEntranceGateOpening) | n/a(geometry) | only measurable on finished World |
| 95 | a child can walk in through the front gate | theWalkInFromTheGateIsWalkable (8466) | road (entranceRoadClaims incl. entrance-gateway-path corridor, entrance/roadCorridor.ts:192, parkPlan.ts:539) honoured by world-phase builders via GroundClaims | partial: gateway corridor claim respected by claims.blockers(); lamps refuse gate LampPosts.ts:670; bridges refuse gateway bridgeFootprint.ts:788; no builder runs the gatewayWalk standability probe | each world-phase builder's advance could run measureGatewayWalk against claims; exact collision only on finished World |
| 96 | the road arrives at the park and goes in through the gate | theRoadArrivesAtTheParkAndGoesIn (8544) | geometry (not a decision): buildEntranceRoad src/world/entrance/Entrance.ts:705 from roadRoute.ts stations | n/a(geometry) | only measurable on finished World |
| 97 | the bus stop and the walk in from it are clear of trees and bushes | theEntranceIsClearEnoughToArriveAt (8787) | trees (treeBuilder Scenery.ts:669), bushes (bushBuilder Scenery.ts:842) | partial: isPlantable refuses onEntrancePlaza 10 m circle Scenery.ts:1322/1357 plus road claims; not the gate-to-drop corridor at DROP_OFF_CLEAR 1.5 m | tree/bush builders' accept could test the gate-to-ENTRANCE_PLAYER corridor directly |
| 98 | you can see the cat bus she arrives on | nothingPlantedHidesTheArrivingBus (8874) | trees (treeBuilder Scenery.ts:669), bushes (bushBuilder Scenery.ts:842); treeline buildTreeline Scenery.ts:1096 (deterministic) | yes: hidesTheArrivingBus refusal Scenery.ts:716 (trees), :855 (bushes), :1151 (treeline) | tree/bush builders already |
| 99 | nothing is planted in the road the cat bus drives | nothingIsPlantedInTheBusRoad (8920) | trees/bushes (Scenery.ts:669/:842) via road claims; treeline buildTreeline Scenery.ts:1096 | partial: treeline refuses canopy in distanceToEntranceCorridor Scenery.ts:1211; in-park scatter only checks trunk/collider vs claims (collision.isClearCircle Scenery.ts:719, :856), not canopy reach | tree/bush builders could test canopy reach against distanceToEntranceCorridor |

### check:park keys

| # | key | emitted at | owner | already-checked | how solver-side |
|---|---|---|---|---|---|
| K1 | route.unreachable | scripts/lib/parkFindings.mts:413 (keys are emitted in parkFindings.mts; check-park.mts:84 only calls measureParkFindings) | layout (doormat probe parkLayout.ts:472) + pathGraph (pinched-lane refusal parkPlan.ts:510); world-phase scatter/stalls can still box a stand in | partial: parkLayout.ts:360/389 refuses unreachable doormats but on a plots-and-boundary world only; parkPlan.ts:510 lane rule; stallsFeature.ts:267 straight-line stand. No finished-world flood from entrance | Worldphase driver after lamps (last builder) could flood NavGrid over the real collision world from the entrance to every interact zone/anchor entrance; interact zones exist only on the finished World |
| K2 | route.crossesRail | scripts/lib/parkFindings.mts:443 | crossings (crossingSitesSearch crossingPlanSolve.ts:460) + pathGraph off-site screen; lawn crossings are stopped only by fence geometry (buildRailFence train/fence.ts:47) | partial: parkPlan.ts:492 screenDrawnPathsForOffSiteCrossings refuses drawn paths off proven sites; NavGrid routes over lawn, which nothing refuses except the fence existing | pathGraph solve already screens drawn paths; the NavGrid-route form needs bridges+fence colliders, i.e. only measurable on finished World |
| K3 | poi.nospot | scripts/lib/parkFindings.mts:490 | pathGraph (path samples seed waypoints, poiGraph.ts:172 SEEDS) + layout (anchor/stall doormats) + world-phase scatter over them | partial: parkLayout.ts:472 probes doormats (nospot kind) on plots+boundary only; parkPlan.ts:483 refuses paths wholly outside boundary; trees/bushes/walls keep off paving via isPlantable Scenery.ts:1351 | worldPhase end: build PoiGraph on the real collision world and refuse; SEEDS depend only on plan, so could be probed after lamps builder |
| K4 | poi.stranded | scripts/lib/parkFindings.mts:555 | same as K3: layout doormats, pathGraph paving, world-phase scatter (walls/trees/bushes/lamps) | partial: parkLayout.ts:472 (poi.stranded kind, plots+boundary world only); nothing re-floods after walls/trees/stalls/lamps commit | worldPhase end (after lamps): NavGrid.reachableFrom entrance over real collision, test each SEED; needs bridges/fence colliders too, so effectively finished World |
| K5 | poi.split | never emitted — only named in HARD_KEYS, scripts/lib/parkFindings.mts:937 | none: no report() call produces this key | n/a: dead key; it cannot fail (connectivity is covered by poi.stranded) | n/a — remove from HARD_KEYS or implement |
| K6 | boot.asserts | scripts/lib/parkFindings.mts:148 | geometry (not a decision): every collider's registered height/thickness, CollisionWorld.checkSubstepBudget Collision.ts:1093, checkHoppableColliders Collision.ts:1138 | n/a(geometry): only run at Game boot (Game.ts:388,393) and here | only measurable on finished World (or per addWall/addCircle at registration time) |
| K7 | layout.falseRefusal | scripts/lib/parkFindings.mts:539 | layout: doormatRefusalsSearch parkLayout.ts:472 (the probe's own accuracy; LAYOUT_REFUSALS_IGNORED parkLayout.ts:764) | no: meta-check on the layout's refusals; only exercised with LGP_LAYOUT_RUNG=off, asserts nothing otherwise | only measurable on finished World (it contradicts a plan-time refusal with the built park) |
| K8 | rail.exclusion | scripts/lib/parkFindings.mts:691 | geometry (not a decision): buildRailFence train/fence.ts:47, continuous flanks except STATION_GAP (fence.ts:188), deterministic from train plan | n/a(geometry) | only measurable on finished World (fence colliders); fence is a pure function of route+stations+bridges, so could be asserted at fence build |
| K9 | rail.walkable | scripts/lib/parkFindings.mts:703 | geometry (not a decision): fence flanks plus centre-rail wall train/fence.ts:354 and bridge deck seams | n/a(geometry) | only measurable on finished World (needs NavGrid reachability over fence + bridges) |
| K10 | anchor.overlap | scripts/lib/parkFindings.mts:825 | layout: candidate validation in parkLayout.ts (~1025-1076) | yes: parkLayout.ts:1073 refuses bounding-circle gap < CORRIDOR_GAP; near pairs exempt, held by manifest near.min (e.g. parkManifest.ts:218) | layout advance — already there |
| K11 | anchor.reach:<id> | scripts/lib/parkFindings.mts:859 | geometry (not a decision): each anchor's built content (AnchorPlots.ts:152) vs its declared boundingRadius (parkManifest.ts:157-200) | n/a(geometry); RATCHET holds building/waterFight at 0 (parkFindings.mts:62,71) | only measurable on finished World (mesh extents); a declaration-vs-mesh contract |
| K12 | anchor.trespass | scripts/lib/parkFindings.mts:911 | trees/bushes/walls (treeBuilder Scenery.ts:669, bushBuilder :842, wallBuilder :949) via isPlantable; lamps (lampBuilder LampPosts.ts:562) | yes: isPlantable->insideAnyAnchor Scenery.ts:1354/1524 (boundingRadius+margin+2.5); LampPosts.ts:679 (boundingRadius+ANCHOR_MARGIN). Treeline (Scenery.ts:373) is outside the park | already in each builder's accept; solver-side measurable per candidate |

### Furnished floors (`theParkIsFurnished`, invariants.ts:11704)

| # | floor | where | owner | already-checked | how solver-side |
|---|---|---|---|---|---|
| F1 | trees > 24 | test/procgen/invariants.ts:11735 (theParkIsFurnished :11704) | trees: treeBuilder Scenery.ts:669 (TARGET_TREES 72 :643, TREE_BUDGET :644); later felling in World (Sky Cruiser, Scenery.ts ~425-490) | no: advance returns 'done' at Scenery.ts:794 whatever the count; no refusal on thinness | treeBuilder advance at 'done' could refuse when out.length <= 24 (pre-fell count; felling happens in World ctor, so exact count only on finished World) |
| F2 | bushes > 180 | test/procgen/invariants.ts:11774 | bushes: bushBuilder Scenery.ts:842 (BUSH_BUDGET 4200 :645) | no: advance returns 'done' at Scenery.ts:909 when budget spent, whatever the count | bushBuilder advance at 'done' could refuse when count <= 180 (felling may still remove some later) |
| F3 | climbable trees > 24 | test/procgen/invariants.ts:11793 | trees: treeBuilder scatter + climb-cover pass Scenery.ts:769-792 (canopy >= CLIMBABLE_MIN_CANOPY_RADIUS) | no: cover pass ensures spread per path cell, not a count; 'done' at Scenery.ts:794 | treeBuilder at 'done' could count topBallRadius >= CLIMBABLE_MIN_CANOPY_RADIUS; exact list (after felling) only on finished World |
| F4 | lamps > 0 | test/procgen/invariants.ts:11794 | lamps: lampBuilder LampPosts.ts:562 (slots may be 'forgone', :617) | no: returns 'done' at LampPosts.ts:619 even if every slot forgone | lampBuilder advance at 'done' could refuse when no slot placed |
| F5 | plots > 0 | test/procgen/invariants.ts:11795 | layout: layoutRestartSearch parkLayout.ts:343 (facts.plots = PARK_LAYOUT.entries, parkFacts.ts:1901) | yes: layout places every manifest entry or refuses (parkLayout.ts:351,355,397); a fixed manifest makes zero impossible | layout advance — already structural |
| F6 | exits > 0 | test/procgen/invariants.ts:11796 | pathGraph: pathGraphSearch paths.ts:3903, exit spurs added unconditionally for cruiser/railRace/slide/ferris (paths.ts:4295-4307) | yes: by construction (4 fixed exit spurs; spur() at paths.ts:3997 always pushes a node) | pathGraph solve — already structural |

## Failing on the base, and who fixes what

Baseline (Overseer, `vet:seeds 0..15` at ae8257fb): every seed passes
`check:park`; only seeds 2 and 5 pass every invariant. First
`accept:parks 0-15` run on this branch (restart 0 = the base park):

| class | seeds (restart 0) | kind | fix |
|---|---|---|---|
| Rail Race sleepers (#55) | 1, 3, 8, 9 | geometry | at cause: #702's one owner of the drawn rail direction, ported (`fix/sb-sleepers`) |
| Rail Race camera runs backwards (#58) | 0, 1, 3, 8, 9 | geometry (camera rig) | at cause: zoom ceiling floor (`fix/pocket-race` diagnosis), `fix/sb-race-camera` |
| coping stones (#82) | 1, 6, 11 | instrument (chamfer) | #698's instrument fix, merged here |
| rainbow legs / connectors (#52, `rainbow.inPath`) | 6 | decision | #698, merged here |
| duck bar slows nobody (#50) | 0, 4, 6, 12, 14 | measured on a simulated ride | to be root-caused: geometry or a slot decision |
| street off the 12 m lattice (#42) | 1, 10, 12, 13, 15 | decision (pathGraph) | refusal in the path graph; restart meanwhile |
| Sky Cruiser supports / through castle / clear of park (#57, #78, #64) | 0, 4, 9, 10, 14 | decision (cruiser, pylons) | restart; pylons move into a builder |
| bridge masonry / tunnel (#86, #81) | 1, 13 | geometry | to be root-caused |
| slide cameras / legs (#72, #69) | 8, 10 | decided in the Building ctor, no builder | restart; later a builder |
| gate arch (#29) | 12 | geometry | to be root-caused |
| bushes floor (F2) | 11 | decision (budget) | restart (a different stream, budget untouched) |

## Consumers

- **Build time** (`build:parks`, #705): calls `acceptPark(seed)` and writes the
  accepted `restart` and the restart log into the park file. The client sets
  `globalThis.__LGP_PARK_RESTART__` from it **before** the park modules load,
  because the boundary is a module constant.
- **`check:park`, `test:procgen`**: measure the accepted park. They are the
  second line; by construction they cannot fail on a park the loop accepted.
- **A browser with no file** (an off-pool `?seed=`) solves restart 0 and runs
  no measures. It is the developer path. The guarantee applies to parks that
  were solved in Node.

## Paused branches

- **#698 `fix/procgen-last`**: merged into this branch. Its instrument fix
  (coping) is required, because restarts must not search around an instrument.
  Its connector screens are rung-1 refusals and they cut restarts.
- **`fix/procgen-residue`**: station crowding as a hard refusal, arch feet
  against the rail, and a spur corner snap. All three are rung-1 refusals: the
  root rule makes them unnecessary for correctness, but they are still worth
  having for cost. Its seed-208 kerb ratio is an instrument question.
- **`fix/pocket-race`**: the seed-128 welcome-sign seal is a decision the loop
  now catches (`route.unreachable`). The camera diagnosis is taken over by
  `fix/sb-race-camera`.
- **`fix/paving-drape`, `fix/path-ribbon`**: new invariants about drawn paving
  (sheets, folds). These are geometry, so each must be fixed at cause before
  its invariant is added. Otherwise the loop would search around them.
