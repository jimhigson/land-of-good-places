# HANDOFF — engine rework: anything solid is landable (feat/engine-solids)

Owner: Engineer (Opus 5.5). Started 17 Oct 2026 from origin/main 58165723.
Jim's ruling (17 Oct): one 3D solid per object; sides bump, top lands; gravity
drops her on the highest thing beneath her; NO floor registry, NO floor/stand
marking; guards stop her by real height, never a flag.

## Branches
- `feat/engine-solids` — work branch, push every commit.
- `feat/engine-solids-pr` — DRAFT PR head, moved only at milestones (fast-forward).
  Every push to a PR head re-solves 16 parks in CI (30-45 min) and cancels the last run.

## Local setup that saves hours
- Baseline worktree (pristine origin/main, detached): `.claude/worktrees/engine-solids-base`.
- Snapshot worktree for long solves (detached at a branch commit, never edited):
  `.claude/worktrees/engine-solids-snap` — `git -C … checkout --detach <sha>` then run.
  Never run a 15-min multi-process solve in the live worktree: later processes load edits.
- Main's 16 park files (source hash c6596b45…) from CI run 38828139475, artifact
  `parks-c6596b45d7f1…`, in `/tmp/engine-solids-baseline/parks-main-all/`.
  Build any seed's park from main's decisions on the branch with
  `LGP_PARK_FILE=/tmp/engine-solids-baseline/parks-main-all/<seed>.json` (4 s, no solve).
- Main's restarts: 0:3 1:1 2:3 3:7 4:1 5:1 6:1 7:5 8:1 9:5 10:9 11:4 12:0 13:6 14:8 15:4.
- Baselines in /tmp/engine-solids-baseline/: `digest-main/<seed>.txt` (hydrated digests),
  `identity-main/<seed>.json` (solved identities, park-identity.mts).
- `/tmp/es-run-identity.sh <worktree> <outdir>` solves all 16 at main's restarts (3 lanes, ~15 min);
  then `node scripts/compare-park-identity.mts /tmp/engine-solids-baseline/identity-main <outdir>`.

## The model as built (decisions, with reasons)
1. **CollisionWorld owns solids.** Circles, capsules (walls) and new filled **boxes**
   (`addBox`, yaw + rounding). `addRectangle` = one filled box with the old four walls'
   exact outline (no hollow middle → no trap argument anywhere). `highestTopAt(x,z,ceiling)`
   = top of the highest solid whose footprint covers the point, within reach (bucketed).
2. **`world/standing.ts` is the one owner of where her feet rest**: max(walk sampler's ground,
   highestTopAt within the same step reach). `Player.groundAt`, playerSim, the parade
   (`Player.standingAt`) and her lattice ask it.
3. **Step rule (decision):** a grounded player walking INTO a solid whose top is within one
   step (BUILDING_STEP_UP 0.62, the reach decks/stairs already use) climbs it. Reason: floors are
   no longer special, so a 0.44 m bench and a 0.44 m deck behave the same; and the beds/cushions
   that were walk-on plates stay walk-on (precedent preserved) without a floor registry.
   `walkingOntoStep` looks just past her front edge, so walking PAST a bench she brushes its side.
   Lateral rule gets a `'stepped'` outcome fed the sampler's own carried reference (consistent by
   construction). The crowd never climbs (no step ceiling passed) → NPC movement unchanged.
4. **Who stands on what:** only the player (and her parade) stand on solid tops. NPCs, procgen and
   every measure's NavGrid use the ground-only `WalkSurfaces.sample` → parks/routes identical.
   Her lattice (`playerLattice.ts`, `NavGrid(..., standsOnSolids=true)`) skips stamping solids within
   a step of the ground and reads levels through `standingHeight`.
5. **Kept separate from solids (ground layer), with reason:** terrain, castle floor plates,
   ramps/stairs (ArcTread, quarter-riser plates), hotel room floor plates, lobby landing/gallery
   decks, station platforms, carriage floors (moving), trampoline (moving), bridge humps, library
   and reptile plinths/steps. They are walked ALONG, their height changes continuously under her
   or they move; as solids their own slope would be a wall to the lateral rule.
6. Deleted: hotel place.ts `standable()` + `stand` option; library props plates/OrientedPlate/
   `soft()`/`stand`; reptile props plates/`stand`; Building `banquetTables`/`benchTops`;
   castleFurniture `greatHallTableTops`; the suite beds' plates. Beds + cushions are solids.
7. ParkMap reachability probe stands at the ground's real y (park ground is ~-14 m).

## Findings
- check:hotel probe 31 handed a ROOM-LOCAL sampler to a lattice that asks in world metres
  (latent check bug); fixed. Lobby ratchet 22 → 0 (sofas are steps now).
- Thinnest collider is the library plinth's 0.1 m edges → sub-step counts unchanged by boxes.
- Hydrated digests: all 16 seeds identical to main after the switch-over (commit e95d83a3).

## Status (18 Oct, 09:00 BST)
- [x] (a) switch-over — PR head 7defc913, CI green, preview
  https://pr-722-7defc91-land-of-good-places.blockstack.workers.dev/hotel (lobby sofas are steps).
- [x] (b) real heights + census — PR head ff686cb6, CI green; CI parks in /tmp/es-parks-b (restarts,
  features, planOrder = main's on 16/16). Preview pr-722-ff686cb… (+ /spawn?pos=16.5,-13.9&facing=-90&seed=5).
- [~] (c) guards tall — work done through f7b39e60 (sections below). Since then:
  - d8e01cd4: check:wall-tunnelling was red (identity clause): the sim's FLAT world carried her
    flight over the planet's curve (306b5218). Flat world now keeps flight height; the control
    carries once after resolve. fb2e0999 + 3b3e3834 (hop refits measured under that sinking flight)
    REVERTED: measuredHopCeiling = main's 1.574 − 0.3c; hop-clearance = main's numbers. Both green.
  - 59e2506b: merged origin/main (#721: put-down rule, wedge rescue, check:exits). shard-3 chain =
    main's + check:solids + check:solids-park (parsed, 179 scripts).
  - fe450617: #721 adapted to the engine (coordinator's brief): feetSampler (standing.ts) is what
    the rule samples; deepestSolidOverlap with KID_HEIGHT for clause 3, sweeps and the wedge depth;
    windows stand on solids (NavGrid.around flag, PLAYER_PUT_DOWN.height/standsOnSolids,
    playerLattice builds from it + World.routeConnectors/routeBridgeCovers); a top with no lattice
    level is walked off on 16 bearings (OpenFloor.getsDown, DROP_WINDOW_HALF); CollisionWorld.near
    now carries boxes + shifted tops (the merge copied circles/walls only). check:exits pockets are
    four walls (addRectangle is a filled box here).
  - 24376487: check:exits found 4 failures on fe450617, fixed: the rule handed her FEET sampler to a
    standsOnSolids lattice (walksOnto then saw every solid's own top as "within a step of the ground"
    → 689 vs 473 free cells; garden pocket called open). putDownSpot takes the WALK surface again and
    composes feet itself (mover.standsOnSolids); the lattice gets the walk surface. Wedge depth asks
    her step ceiling (a pet bed in a wall corner left her 0.11 m in it). Near view: main's reach;
    walk-offs build a wider view lazily. check:hotel probe 33 now walks as she does (her lattice,
    feet levels under her hop, BUILDING_STEP_UP, drops any height, KID_HEIGHT body; control pen 0.8 m).
  - Local gate at 24376487 (snap5, b's parks restamped): shards 1-9 all exit 0 (parallel, ports
    5791-5799, /tmp/es-shards2), test:procgen 0 (46 files, 2154 tests), build 0. Look (port 5813,
    killed): railings, fence, put-down on a wall top (moved 0), café let-go (moved 1.0, found).
  - Park hop (es-parkhop.mts, seed 5, real sim on the planet): branch 173/1550 not clean on 12 walls,
    none stuck; main's code 276/1270 on 14 walls, 2 walls stuck from one side. Pre-existing; PR gap.
  - 450cb467: NavGrid skips colliders that miss the lattice before walksOnto (a window asked the walk
    sampler under all ~3,800 solids): put-down 14.1 → 7.1 ms (main 5.8, idle). Gate at 450cb467
    (snap5): shards 1-9 exit 0 (/tmp/es-shards3; check:exits 582 put-downs 6.6 ms avg), test:procgen 0
    (46/2154), build 0. PR head pushed there; CI run on 60f43769 superseded.
  - CI run 39111869119 on 05906dc9: ALL GREEN (88 success, 1 skipped) but Checks shard 5 took 26m45s of
    its 30-min cap (watchdog: 89%). Cause: check:wall-tunnelling's ~200k fresh worlds each gridding a
    10 km wall into 2,500 string-keyed cells (0.6 ms). c1ceb044: wide colliders (>256 cells) go in one
    shared bucket; numeric keys. Local sweeps 75 s (main 46 s; was 130+ s). Gate at c1ceb044: shards 1-9
    exit 0 (/tmp/es-shards4), test:procgen 0 (46/2154), build 0. PR head → c1ceb044+.
  - CI parks (run 39111869119, /tmp/es-parks-c) vs main (/tmp/es-parks-main2): 14 same; seed 1 one
    trestle 1 m along; seed 9 restart 0 (main 5: its bridge-standability probe at the wrong height).
    vs (b): 16/16 same (digests differ: fence, railings, copings).
  - 1322d72a: check:exits rules (i) a crate's top she walks off is left alone, (j) a crate in a sealed
    pit is not; both proved red (walk-off off → (i) found=false; any landing open → (j) left as given).
    Proofs at c1ceb044 (/tmp/es-proofs7): all 11 check:solids proofs exit 1 on their clauses.
- **DONE (18 Oct 12:05 BST): PR head = 9edf7563, CI run 39124376616 SUCCESS** (all 9 check shards, 6 procgen
  shards, build, coplanar, swept bus, entrance road, every seed builds, walk reach, preview; Deploy
  skipped). Shard 5 11m55s, shard 3 15m05s (longest). Parks from cache (run 39119914321, 1a62e8e8):
  byte-identical to 9c580b6e's. Preview (c): https://pr-722-9edf756-land-of-good-places.blockstack.workers.dev
  (+ /spawn?pos=-8.2,42.1&seed=5 railings; /spawn?pos=-48.7,65.8&facing=34&seed=5 fence) — loaded in
  headless Chrome, 0 page errors. PR body = /tmp/es-pr-body.md (posted). Not merged (Overseer merges).
- Previews: (a) pr-722-7defc91…/hotel; (b) https://pr-722-ff686cb-land-of-good-places.blockstack.workers.dev
  (from the PR's own comment). (c): the newest "Deploy PR preview" comment once CI deploys.
- Next: CI green on the final head, compare CI parks (/tmp/es-compare-parks.mjs), preview check,
  PR body (/tmp/es-pr-body.md), report.
- Planet note (measured, es-leanreach.mts): with the carry, a jump's apex over the ground is
  cos(lean) × flat (gravity is along world y): 1.23 m middle, 1.20 @44 m, 1.13 @85 m inward;
  outward adds the damp lag (to 1.41). Pre-existing physics; hop policy is position-blind.
- My dev server PID 87427 (port 5798) — stopped 02:10.

## Round 2: review (changes requested) + QA (not approved), 18 Oct afternoon
Review: /tmp/review-722/review.md (comment 6250201443). QA: /tmp/es-qa-722.md (comment 6250543626).
Work list (tick as done, commit each):
- [~] R1 check:solids: ROOF_KINDS + roof-kind guard + proofs (reptile-roof, every-roof, new-roof); 5 hotel
      rooms censused; drawnTops ancestor visibility; fps note (SOLIDS_FPS). Prove each red.
- [ ] R2 delete `ledge` (hotel 33 sites + library armchair arms/back): measured top + topHalf from the drawn
      geometry; fix the ocean-room trap at its cause; list newly standable things. Also the other
      toppedNarrow(0) declarations (library plinth edges, booth bumper walls) -> measured.
- [~] R3 railway: corridor band = CLOSURE (CollisionWorld.asClosure: NavGrid + planner read it, no body
      meets it). Census: solidReach jumps when her run stalls (crate-against-fence control). Proofs
      guards-alone (everyTopWide) and fence-crate. End-cap middles (2.2 m invisible, train passes) remain.
- [ ] Q1 auto-hop from on top of walls/rim: height-aware wouldAutoHopClear (feet; a step is a step);
      census + check:solids with the REAL hop probe; clause: walk the length of every wall top/rim.
- [ ] Q2 bridge railings jumped down-slope from the crown: railing height vs the highest her feet get
      beside it (choose + reason); clause: sprint-jumps at every railing/fence never clear it. Fix body's
      "1.1-1.4 m" (QA: 1.49-1.50 outward at 65 m).
- [ ] Q3 /spawn?pos=x,z: teleport with no y stands her on the floor or a step's top, never a roof.
- [ ] Q4 foyer log shuttle: walkingOntoStep must see the standable band anywhere along her lookahead;
      castle bench stutter; library plinth SE (fine: lip too thin to step, jump clears it).
- [~] Minors: yAtRadius/planetRadiusAt (done), BUILDING_STEP_UP/JUMP_CLEARANCE_GRACE imports (done),
      Collision header + circleSeparation/wallTopReaches docs, GREAT_HALL_TABLE_HEIGHT, NPC post-cap bump,
      PR body (jet pack, library tracks note, railway account, seed 9 cause = radial tops).
- Local runs need .parks restamped after EVERY src edit (/tmp/es-restamp-parks-final.sh <wt>), else a
  script triggers a 12-min seed-5 acceptance.
- 5d0824bc: R1 proofs red (reptile-roof, every-roof x9, new-roof); fence-crate now red (stage 4b used to
  ask only standable tops, so never tried a fence); drawnTops shows the 4 space roots (interiorRoot,
  hotelRoot, library.roomRoot, reptileHouse.hallRoot). core: 1 red left = suite sofa (see R2).
- R2 findings/decisions so far:
  - Suite sofa: plan halfX 1.1 / halfZ 1.3 is NOT the drawn sofa (sofa(3.2): 1.6 x 0.475) and its
    collider was the swept AABB -> she stood on air at its corner (core clause 2). Fix: parts (seat 0.5,
    back 0.92, arms 0.64) turned with the model (place.ts addBox yaw = +spin measured best? CHECK sign).
  - Ocean-room "trap" (-606.4,1907.6) = a drop off SEAWEED (0x60c3 at local -6.0,7.2) once its fake
    1.5 m top was standable. Measured seaweed/crystal tops are points (topHalf ~0) -> unreachable.
  - Pans/basins: KID_HEIGHT 2.12, privacy roof at 2.42 -> on the lid (0.74) her head is through the
    roof. Plan: the privacy roof becomes a banded solid ceiling (base 2.42, not navStamped) -> headroom
    makes lid/cistern unreachable by physics; parts measured from Toilets.ts constants.
  - Cart walls (filled booths) -> closures (box is the drawn cart); library plinth edges ->
    toppedShifted inward t/2 + topHalf t/2 (END_HALF 0.2 -> band 0.1 = standable): sides become steps
    where <= 0.62 m (visible change; QA's 'plinth SE' answer).

### Round 2, later (18 Oct evening)
- 84f05839 R2 (measuredTop.ts, sofa/pan/basin parts, privacy roof lid, armchair kitTop, plinth edgeRuns,
  cart walls closures, check:hotel lobby 6 declared); 33f38f6c minors (Collision docs, GREAT_HALL,
  wooden posts navStamped). JUMP_SPEED/GRAVITY now in core/constants.
- Q2 DECISION: (a) guard height against the highest her feet can get (src/world/jumpReach.ts: jumpRiseAt,
  runLagOver, guardRadiusNeeded, GUARD_MARGIN 0.05). Reason: her jump is right (same every direction);
  (b) world-y flight would only move the problem to outward ramps and re-bias jumps.
  - bridges.ts: BridgeWall.guardTop/guardTopEnd from deck takeoffs (3 lines across, 0.25 m along);
    railing draws extra rails every 0.5 m; ParkTrain collider uses guardTop. Seed 5: up to ~3.3 m over ramps.
  - fence.ts: per-post `lift` (liftAt over a cached 0.25 m takeoff grid: terrain + station platform
    decks, minus closures (corridor bands built FIRST now) and bridge masonry), liftBay for mid-bays,
    capLift for end caps, station far-side posts too. Found: platform ends cleared end caps into boxes
    (sim: landed (-28.3,11.4) seed 5) and platform edges cleared the far fence into the stranded strip.
  - scripts/lib/guardReach.mts + check-solids clause 8 (analytic, both sides, closures/solids/parked
    train out; control = guard height alone; sims at 24 closest calls). Seed 5: 0 short.
  - ParkTrain.onCarriage(x,z) for the check (parked train's floors are not takeoffs).
- Q1/Q3/Q4 clauses 9/10/11 in check-solids; proofs SOLIDS_PROVE=blind-hop / spawn-highest / single-step.
  standing.ts: teleportHeight (Player.teleport uses it), walkingOntoStep(samples), STEP_SAMPLES exported;
  SimPlayer option stepSamples.
- Collision.closedAt(x,z) (bucketed closure query).

### Round 2, state at 1897d5e0 (18 Oct night)
- check:solids green at this head: park (504 tops, 84 regions; clause 8 0/4203, control 1170; 9: 66 walks,
  71 step-ups; 10: 0/3163; 11: 0/91) and core (161 tops; 9: 18 walks; 11: 0/532). check:hotel green.
- Proofs red at this head: reptile-roof, every-roof (10), new-roof, fence-crate, blind-hop (33/66, 71/71),
  spawn-highest (3163), single-step (52), drawn-feet (66). guards-alone: railway 0 places (green!).
- d4f6d525: resolveMovement feetY (standing feet = groundHeight) fixes the trough flicker; sofas back to ONE
  box at the seat on the drawn turned footprint (PLAYER_RADIUS 0.62 doesn't fit a 0.7 m seat before a solid
  back); check:hotel bathroom probes use deepestSolidOverlap; suite toilet stand 0.19 m back.
- Known gap: walking on across a bed into a wall (gap < body) jitters at the edge (clause 11 notes it).
- Replies drafted: /tmp/es-reply-review.md, /tmp/es-reply-qa.md; body /tmp/es-pr-body2.md (placeholders
  PREVIEW_*, SIXTEEN, GATE, IDENTITY). Repro scripts: /tmp/es-qa/ (repros.mjs, devtrace.mjs, devbridge.mjs;
  rim/post links need a height: /spawn?pos=-2.1,1.08,-6.9 and /spawn?pos=24.1,-2.233,31.1).
- Next: gate (check/procgen/build) -> 16-seed park census (/tmp/es-seeds.sh) -> move PR head -> CI ->
  compare parks with /tmp/es-parks-final -> preview repros -> post replies -> body -> handoff -> report.

## Decisions made in (b) (with reasons)
- **solidInFrame** (terrain.ts): a rigid group stood on the sphere (plots, shelter, station) puts a
  solid at the column its middle is drawn in, top = hypot(R+top, lx, lz). Plots used centre+local,
  0.64 m off at the dodgems' barrier on seed 5 — standing on air beside the rail once tops are real.
- **The crowd clears tops from its takeoff** (`resolve(..., feetY)`): NPCs never stand on tops, so a
  hop must never carry one over a footprint. Keeps NPC walking what it was.
- **Headroom** (`solidStepCeiling`): a top she can't fit on (head into the solid above) is a side,
  not a step. One owner for lateral rule, feet, playerSim and her lattice.
- Ghosts given solids (new footprints, so NavGrid/crowd may differ — CI re-solves): dodgem light
  posts, ferris railings (old walls stood across the open ends), pool rims (old: invisible post in
  the water), sprinkler, bus shelter bench + canopy, station benches + awnings.
- Left as found, listed for the census: the welcome sign's board (1.65 m underside over the path she
  walks — a solid would block the path; raising it is a (c) visible change); tall leaning props keep
  colliders at their feet (lean offset is pre-existing, orthogonal).

## Notes for the paused Library tracks (-owl, -kids, -den, -books2)
- `props.ts`: no plates, no `stand`, no `soft()`; `box()` returns `[BoxCollider]` (one filled turned
  box); `detach/attach` take walls or boxes. Keep-outs ignore solids within a step of the floor.

## Census, garden, seed 5, 60 fps (at e5b4f87a, es-census.mts)
797 tops, 24 regions, 14886 jumps, 316 s. By kind: bush 296, railway fence 166, fence post 131, pool
rim 56, bridge parapet (unlabelled capsule 0.15) 31, fountain rim 28, dodgems barrier 24, stone wall
19, wooden wall 16, stall booth 8, library plinth edge 3, stall awning 3 (roofs!), station canopy 2,
dodgems car 2, ferris deck rail 2, hedge 2, dodgems tree/ferris deck/station bench/gun rack/cruiser
pylon/fountain centrepiece/ferris leg/tree 1 each. Regions via drops: bushes (pockets), railway fence
(-83.3, 27.4), ferris deck/rail, pool rim, wooden wall, stall booth (-43.1, -42.9).
(c) candidates: railway fences + bridge parapets (railway), stall awnings (roofs), castle roof
battlement (troughs → merlons → void), hotel balustrades (drop to lobby).

## check:solids (scripts/check-solids.mts, commit 18656597) — not yet in the chain
Clauses: 1 real tops, 2 landings on drawn tops, 3 precedents (+1.0/1.6 m controls), 4 census (park +
castle floors + hotel lobby + library + reptile hall; guards climbed / railway / off-floor / traps),
5 marches at new kinds, 6 headroom, 7 boundary at height. Red proofs via SOLIDS_PROVE: infinite,
too-tall, ghost, no-bounds proved red (fast clauses, SOLIDS_SKIP_CENSUS=1). low-top, low-fence, trap,
no-headroom need the census run.

## (c) in progress
- **ROOT CAUSE of guards still climbed after the fence raise (306b5218): the planet's lean.** Flight
  integrated world y while she moved in plan, so the ground fell away under an outward jump: bare
  planet (es-leanreach.mts), sprint-jump outwards reached 2.37 m @44 m from centre, 2.84 @60, 3.1 @70+
  (1.23 in the middle). No guard height could hold. Fix: airborne, her y is carried by
  `carryReference` per sub-step (Player, playerSim, NpcCharacter + takeoffY). Now 1.10–1.41 m
  everywhere (spread = damp lag over the ground running downhill; kept — snapping down would dip her).
- Same commit: a jump takes off from max(drawn y, ground): uphill the damped y lags UNDER the ground
  and the jump landed on frame 1 — sprint-jumping inward did nothing past ~38 m (walk ~55 m). Pre-existing.
- Fence trace before the fix (es-fencefrom.mts): 124 of the fence tops reached "from the ground".
- SOLIDS_SPACES=park (etc.) runs the census over named spaces (dev switch, notes what it skipped).
- Jet pack (PARK_FLY_CEILING 12 m) now meets real tops: it can land on fence tops and roofs under
  12 m. The rail centre band (Infinity) and the soft bounds still hold at every height. List for Jim.
  es-islands.mts: sealed hollows open to the sky = castle courtyard (drawn deck has no solid!),
  library cella, reptile house, hotel tower (28 m walls: unreachable). TODO lids (banded, no lattice).
- 123d0092 corridor fill: band 1.3 left a 0.52 m slot before each fence → wedge trap (10 places).
  Fill runs inset by their half-width from box ends; both lattices hash identical on 16 seeds.
- Census policy (fc52ff0d): escapes asserted as PLACES (roofs, enclosures, railway corridor/inside
  fences, off-floor, traps); guards stood on but not passed = stderr note (PERCH_KINDS).
- 4366838c: reach can start ON a top (cubicle stool false trap); `until` early stop (hotel 4 min→95 s);
  clause 7 starts pushes where she fits (corridor near the edge at 124°).
- 8d2e5f26 ENGINE: toppedNarrow(half)/FOOT_HALF_WIDTH 0.1 — a top < 20 cm wide holds nobody
  (no stand, no step, lattice agrees). Applied: fence rails/posts, booth panels, hotel handrails,
  reptile stall back panel. Reason: they were launch pads (rails 9 cm, panels 6-18 cm).
- 888f2a07 reptile: beds 2.4→3.1 (house's walls; beds were walked via stall back panel), nursery
  glass 2.1 (VISIBLE; log→nursery jump). Chains now end at the pads.
- Remaining (c): clause 2 drawn-top mismatches (bush/hedge foliage rulings, parapet coping/TopSlope,
  fountain rim overhang, dodgems barrier/car/tree, ferris deck/rail, water gun rack, wooden/stone
  walls, mall planters, counters' stock, throne arms, lobby statue hand, library chair), the
  corridor seam ledge beside bridge decks, stall awning (1), hotel toilet cubicle trap, lids,
  proofs, chain shard, gate, look, PR.
- Railway fence raised: posts 0.95 → 1.75 m, a top rail at 1.62 (top 1.67) over the old knee rail.
- Castle roof: soft edge at the battlement's outer face (+ lift alcove) — `floorBounds.ts`
  `castleFloorBounds` (one owner; NPC journey asks it too). The invisible slide-mouth wall is gone.
- Decisions: interior drops onto the same room's floor (hotel gallery) are physics, not escapes —
  listed for Jim (raising the balustrade = the hotel's authored rail height, shared with stairs).
- Open: stall roofs (awning reached via booth walls / bushes), bush launch pads (crowns to 2.1 m).
- 1ad50ede: seed 9 restart 0 at (c) (0170dc95) was REJECTED by check:coplanar alone — top rail (level
  at the bay's mean) in the plane of the downhill post's cap where a bay rises 17 cm (8.2 mm, 0.006 m²).
  Fix: rails pitched post to post (match their TopSlope solid). Re-attempt seed 9 r0 after it.
  Any mesh change: run `es-fencecop.mts` (check:coplanar's sweep on the fence group) before a PR push.

## (c) state at 62c2ce75 (21:15, 17 Oct)
- check:solids split: `--part=core` (check:solids: clauses 1,3,5,7 + census of every building + jet
  pack report; 68 s) and `--part=park` (check:solids-park: park census + 2 + 6; 3m50s). Both in
  check:shard-3 (CI 55 s at b; local 49 s → CI ≈ local ×1.1). chain-coverage ok (95 leaves).
- Old clause 8 (open to the sky) REMOVED as an assertion: it failed on the strip beyond the railway's far
  fence (708 cells) = a place only the jet pack reaches, and she flies out (canFlyHere anywhere in the
  park while worn). Now a stderr report. Proof sky-trap gone.
- Census speed: 705 s → 201 s (2b skips far sides past the leash/inside solids; 2/3 skip tops past the
  leash (boundary wall); missed jumps end early (verticalVelocity<0 & below top); walk-off stops at the
  landing). Same 617 tops; regions vary (36–78, all leavable) — they are mostly the lattice's blind band.
- Fence rails: each end = its post's own leaned point (6cba00e3). check:coplanar (real, b's parks in
  /tmp/es-parks-b, `/tmp/es-restamp-parks-b.sh`) OK on 16 seeds; control at 72f273af found seed 3.
- Stone walls: toppedSquare(COPING_END_OVERHANG); wooden wall posts: own banded solids (72f273af).
  Clause 2 park: 241 landings, 0 off.
- Remaining: proofs (/tmp/es-proofs), gate (check/test:procgen/build + sweep:fountain-hop), seed 9 r0 +
  seed 3 attempts, look, PR head push, CI, preview, PR body, final report.

## (c) state at 52e2d5b2 (22:10, 17 Oct)
- New clause: every top she reaches she can get down from (hemmedIn tops searched); proof `stranded`.
- Census fixes found by the proofs: walk-off compares with the top in HER column (radial tops fall away
  0.2 m/m) — spurious drops gone (regions 71→38); the start region is the lattice flood only if it
  covers the start, else (ground start in a stamped cell) only if she walks into it, else a 0.5 m disc;
  stage 2a hops from each region's entry at tops within 2.5 m (bush-pocket false traps).
- Proofs at 52e2d5b2: all 11 red (exit 1) on their clauses; green controls core+park exit 0
  (/tmp/es-proofs3). Seed attempts at c296f8b1 (same src): 9 r0 ACCEPTED, 3 r7 ACCEPTED (fresh solves:
  delete .parks first or the attempt hydrates and stall-accommodate is 'broken').
- test:procgen 0 (46 files, 2154 tests), build 0, sweep:fountain-hop 16/16 (c296f8b1).
- check:flat-primitives caught a y difference in the jet pack report → altitudeAt (42dfdb38).
- Look (c296f8b1, port 5797, killed by PID): stone wall, wooden wall, fountain rim, crate (keys released
  over it), trough, bench stood on; 1.67 m fence not climbed. /tmp/es-look/shots-c/.
- PR body draft: /tmp/es-pr-body.md (placeholders __PREVIEW__, __IDENTITY__, __LOCALCHECK__, __CI__...).

## (c) state at 81861e39 (01:30, 18 Oct)
- ALL-SEED census (was seed 5 only): found the railway reachable on 10/15 other seeds via bridge
  parapets (drop off the coping onto the track → trapped by the 1.67 m fences). FIX: railing on every
  parapet at RAILWAY_GUARD_TOP (fence.ts owns it + GUARD_RAIL_WIDTH/DEPTH), parapet solid to the
  railing, unstandable (7642e0ac; posts r 0.07 for coplanar, baa0ca94; flat-ok 1f0c5562). VISIBLE.
- Reptile house plinth plate used building-local height as world y → floated 9.65 m up on seed 13
  (pre-existing on main) → roof escape. FIX 2339e1c3 (radius at the plot).
- Keychain cart walls hold nobody (filled core is the top); station bench backrest narrow; library
  plinth edges unstandable; buried wooden posts get no solid; garden walls: toppedShifted (engine:
  tops where drawn, lean) + stone square top measured from the drawn coping ends.
- Census fixes: foliage ignored by the drawn-top oracle; step-1 needs standsAt; until asked first
  at every landing; 2a hops (tops, over-hops, 16-bearing hops when until); wedged landing = none
  (never settle: it ejects through walls — proof caught it).
- 16-seed census at e0c63589/d33cb4d2: 14 green, seed 15 station bench 0.20 m (lean, left as gap).
- Local gate restarted at 81861e39 in snap5 (/tmp/es-gate-d), proofs in /tmp/es-proofs6.
- 3b3e3834: measuredHopCeiling = the measured lower envelope (knots per measured half, −1 mm): the
  straight refit fell under the fountain rim (1.0 m @ 1.88) → boot.asserts 28 on every seed in
  test:procgen. Now test:procgen 0 (46/2154), build 0, sweep:fountain-hop 16/16, hop-clearance 0.
- 16-seed census at 81861e39: 15/16 green; seed 15 far station bench 0.20 m (documented gap).
- Proofs at 81861e39 (/tmp/es-proofs6): all 11 red, controls green. PR body draft /tmp/es-pr-body.md.
- Full local check restarted at 3b3e3834 (snap5, /tmp/es-gate-d). Then: push PR head, CI, preview.

### Round 2, gate and PR head (18 Oct, 17:30 BST)
- Local gate at 73dba6a6 (live worktree, final-CI parks restamped, hash c0daaa03…): test:procgen exit 0
  (46 files, 2154 tests), build exit 0, check:coplanar exit 0 (186 seams, all in baseline);
  `pnpm run check` running -> /tmp/es-gate/check.log (ends "exit N").
- PR head feat/engine-solids-pr fast-forwarded 9edf7563 -> 73dba6a6; CI run 39145152633.
- 15-seed park census running: /tmp/es-seeds.sh <wt> /tmp/es-seeds (logs <seed>.log, last line "exit N").
- After CI: download its parks, `node /tmp/es-compare-parks.mjs /tmp/es-parks-final <ci-parks-dir>`;
  preview from the newest "Deploy PR preview" comment; `PREVIEW=<url> node /tmp/es-qa/repros.mjs`;
  fill /tmp/es-pr-body2.md + /tmp/es-reply-*.md placeholders; post; report via SubagentHandback.

### Round 2, the fifteen other parks (18 Oct, 18:00 BST)
- 15-seed census at 73dba6a6 (/tmp/es-seeds): only seed 0 green. Classified:
  - clause 8 sims "crossed" at station ends (1,3,6,7,8,9,10,13,14): a run off a platform's end round the corner
    where the fence turns into the end cap — never over the guard. Fix 628db46a: crossing = her path over the
    guard's own segment, net (trail from runAndJump). New proof SOLIDS_PROVE=low-guard (1 m fence by the gate).
  - clause 9 step-ups: hop at the NEXT wall after stepping over this one (2,3,7), hop at an L's taller arm (1,2,8).
    Fix: walk ends once she stands on the top; a hop is legit where something > a step over her feet is at her probe.
  - clause 9 along-walks hung on seeds 4, 11, 15 (search `while |t| > 0` never ends) — bounded.
  - playerSim asked the auto-hop BEFORE the fall check (Player: after) — a bush nudging her off a wall top made the
    sim hop (9, 12). Sim now falls first; along-walk ends at a fall (stderr count).
  - clause 2: library plinth edges 0.15-0.16 off on 2,3,7,9,13,14 = chord sag L²/8R of a 17 m straight top.
    Fix bf7bc61e: edges in pieces ≤ 2 m (src → park hash changed; restamped).
  - seed 6: a stall awning reached: bush → 2.4 m wooden wall top (chain) → sprint-jump 8.6 m onto the awning.
    Honest geometry + physics. OPEN QUESTION (not fixed): brief says roofs are escapes "where the camera can't
    follow"; the census (and review) hold every roof. Recommend: open-air canopies are tops, or procgen keeps
    stalls out of jump reach of tall walls. Left red on seed 6, reported.
- 61678960: unknown SOLIDS_PROVE throws (a typo used to run unbroken and look green).
- Reruns at 61678960: /tmp/es-r8 (job list jobs4.txt, runner job.sh; 16 seeds + proofs).

### Round 2, guards and the grace (18 Oct, 19:00 BST)
- Rerun at 7c74ac25 (/tmp/es-r8): seeds 0-3, 7, 8, 12-14 green; remaining: 4 (railway reached over a bridge
  parapet), 6 (stall awning), 9/10 (clause 8 sim crossings), 4/11 (step-up rise 0.60 borderline).
- ROOT CAUSE seed 4: JUMP_CLEARANCE_GRACE (0.15) lets her through any top within 0.15 m of her feet; guards were
  built to feet's highest + 0.05 only. a252dc03: guardRadiusNeeded adds GUARD_OVER_FEET = grace + margin (bridges
  and fence lifts 0.15 m taller where a jump sets them; seed 5: 30 posts lifted 0.01-0.77, tallest railing 3.59 m
  over its deck). guardReach counted no takeoff on a bridge span (corridor closure under it) - fixed.
  Step-up exemption uses riseBetween (hop's own rise). check:coplanar OK on 16 seeds at a252dc03.
- PR head -> a252dc03 (CI run 39150059422). Full rerun (16 seeds + proofs) at a252dc03: /tmp/es-r9.
- Local at 7c74ac25: check:library, check:hop-clearance, check:wall-tunnelling, check:exits exit 0.

### Round 2, the waiting train and the walk surface (18 Oct, 20:00 BST)
- 737aafc1: fence takeoffs = WalkSurfaces.sample (every plinth/step; World hands it to ParkTrain) + each
  station's waiting train (ParkTrain.dwellFloors). Seed 6: a sprint off the library plinth cleared the fence;
  seed 8: a jump off a waiting carriage's floor cleared an end cap. guardReach counts dwell floors (onCarriage gone).
- Final 16-seed census at 737aafc1 (/tmp/es-r10): 14/16 green. Seed 6: stall awning (open question, see above).
  Seed 15: far station bench 0.20 m (lean gap, documented since round one). Proofs all red as intended;
  guards-alone keeps the railway green.
- Local at 737aafc1: test:procgen 0 (46/2154), build 0, check:park 0, check:coplanar 0, check:solids core 0.
- PR head -> 737aafc1, CI run 39152595871.

### Round 2, finishing (18 Oct, 20:00 BST)
- Drafts: PR body /tmp/es-pr-body3.md (placeholders PREVIEW_ROOT, PREVIEW_BRIDGE, PREVIEW_STATION, PREVIEW_WALL,
  CIRESULT, IDENTITY); replies /tmp/es-reply-review3.md, /tmp/es-reply-qa3.md (HEADSHA, PREVIEWURL, PREVIEWQ1..Q4,
  PREVIEWQ4BENCH). Repro script for the preview: /tmp/es-qa/repros2.mjs (verified on a local prod build).
- FOUND (not fixed, in the gaps): QA's reptile link /spawn?pos=49.19,-8.58 now puts her on the floor INSIDE Sunny's
  sealed ring (as main), not the roof. #721's put-down rule calls any region >= 6 m walkable a room; the ring's hollow is
  18 m. Fix = fill sealed insides (reptile ring, library cella, hotel tower) with bodies; own change.
- Waiting on CI run 39152595871 (737aafc1); then preview repros, parks identity (artifact parks-9af23e21...), post.
- CI run 39152595871 (737aafc1): shard 1 RED at check:flat-primitives — my second copy of Player's fall test in
  playerSim (`this.position.y - groundY`). 0539d9ce: one helper `fallIfOff`; check:shard-1 exit 0 locally.
  LESSON: run the whole `pnpm run check` (or at least shard 1) after ANY scripts/ change before pushing.
- PENDING comment fix for the next src change (reverted in 188148dd to keep the parks cached): fence.ts 1b says
  "her feet top out at 1.33 m"; should be "1.28 m over it, a guard has to stand GUARD_OVER_FEET (0.2 m) over that".

### Round 2 DONE (18 Oct, 21:05 BST)
- PR head 61b753de, CI run 39159404420 SUCCESS (9 check shards, 6 procgen shards, build, coplanar, swept bus,
  entrance road, every seed builds, walk reach, preview; parks reused from 39152595871, same hash 9af23e21).
- Preview: https://pr-722-61b753d-land-of-good-places.blockstack.workers.dev (all four QA repros + the bench and
  both spawns played there, 0 page errors; frames on qa-screenshots/pr722-r2/).
- Parks vs round one (es-parks-final): same 16 parks (restart/features/planOrder/measures and acceptance outcomes);
  digests differ (fence lifts, railings).
- Posted: review reply issuecomment-6254433031, QA reply issuecomment-6254433232; PR body updated (/tmp/es-pr-body3.md).
- Open for Jim: seed 6 stall awning (policy); sealed-shell put-down (reptile ring/library cella/hotel tower);
  seed 15 bench lean. Pending comment fix in fence.ts (see above).

## Round 3 (19 Oct): review 6254802924 (changes requested) + QA 6255523819 (not approved)
Review copy: /tmp/review-722b/review2.md (its stage code is gone; outputs in /tmp/review-722b/mut/TG*.out).
QA copy: /tmp/es-qa3.md (scripts: .claude/library-build-scratch/qa722b/).
Work list (tick as done, commit each):
- [x] cost: per-frame gather (4b950ba7), step-up fast paths (97f157f6): census 194 s -> 15 s on seed 5, same output.
- [ ] R1 BLOCKER tops as takeoffs: fence relift after the world phase (reachable tops BFS, World calls it),
      census stage 4c (every reached top -> every guard within JUMP_PLAN_REACH, aimed 1.5 m past, run-ups),
      box landings per seed = 0 on 16 seeds; proofs fence-crate (red on 4c), fences-4m (GREEN, 0), fence-bush (red).
      clause 8 analytic counts the census's reached tops as takeoffs.
- [ ] R2/Q4 railings: far side rule (taller only where a jump over it lands on the line); friendly continuous line.
- [ ] R3 toilet lid: its solid only while drawn (toggle), body lists every invisible solid honestly.
- [ ] R4 cost: deep-links +2m45s on CI = boot cost (fence lift 0.23 s/boot: WalkSurfaces.sample 2.9 us, 141
      platforms scanned per call) -> platform index; wall-tunnelling 52 s local (main 48).
- [ ] R5 minors: roof classes by structure (gazebo), Player.ts orphan comment, everyTopWide out of Collision.ts,
      fence.ts 1b comment ("1.28 m", GUARD_OVER_FEET 0.2 m).
- [ ] Q1 stone wall (-49.6,61.6) seed 5: top 0.12-0.41 m over feet, no step-up, no hop -> stopped dead. Fix at cause;
      step-or-hop deterministic (15/49 hop, varies 12/15); clause 9 fails a walk pressed at a face; sweep every wall
      face 16 seeds both sides several points; prove red on this wall.
- [ ] Q2 library armchairs: arms/back/seat bodies as drawn; census counts wedged landings as failures; sweep every
      chair/sofa/bed/armchair in every space (jumps + walk-ins): on its top or turned away, never wedged.
- [ ] Q3 wall-and-bush loop /spawn?pos=-35.9,-9.2&seed=5 hold up+right: lands 0.17 m inside the bush, rescue blinks
      back, repeats. She must land ON it; the rescue never re-wedges under the same held input.
- [ ] Preview plays: bush-to-fence (/spawn?pos=-36.5,-2.03,4.2&facing=35&seed=5), the wall, the armchair, the loop.
- SCOPE CUT (coordinator, from Jim): ONLY R1 (tops -> guards, 4c + controls + fence-bush, 0 box landings x16),
  Q1 (knee wall: step or hop, never stopped; clause 9 fails pressed walks; deterministic), Q2 (armchair bodies;
  census counts wedged landings as failures), Q3 (wall-and-bush: lands ON the bush; rescue never loops).
  DEFERRED (list under "Follow-ups" in the PR body, do not start): railing styling/lowering (heights only where R1
  needs), CI shard-5 speed-up + per-frame cost (4b950ba7/97f157f6 already done+green: kept), toilet nook ceiling,
  roof-name guard, Player.ts orphan comment, everyTopWide hook. Local runs: only the clauses these touch + tsc.
- Q1 cause found: wall (-51.88,61.57)-(-47.29,61.57) half 0.34, top shifted (-0.108, +0.135) by the lean. Her
  step stretch (STEP_LOOKAHEAD 0.72 m) ends 0.1 m into the footprint, 0.035 m short of the shifted top; the
  hop probe calls it a step (0.12-0.41 m over her feet) -> neither. Rig repro: es-q1wall.mts (stops at z 60.605).
- Done so far (19 Oct): efb3052f Q1 (stepTopAt: body not drawn top; hop judged from the contact point, steps only
  when takeable) + wedge owner (standing.wedgeDepth, anyWidth: step-high narrow tops never wedge -> armchair holds
  her) + crack rules (dropWedges hold, crackFloor); 8bd? (see log) squeeze lift / nearestFit / walk-into-wedge refusal,
  census walk-offs only from the top, library lamps by crowns; cc5e539d fence raise (reachableTops BFS mirroring the
  census: walk rings 0.3-3 m, chain gap 6, rise 1.6, headroom; lamp-post finials narrow; mid rails every metre);
  e9defeac check:solids 4c + clause 8 tops + clause 9 face sweep + proofs fence-bush, fences-4m, drawn-step.
- ALWAYS run scratch scripts through /tmp/es-run.sh (restamps first): a stale park hash makes the harness hang at 0% CPU.
- Seed 5 before 4c: census park green incl. 0 wedged landings; core green after the lamp crowns (re-check).
- Fence after raise: seed 5 136/174 posts lifted (most 0.5-1.5 m; max +2.76 by a wooden wall post), seeds 0/4/6 <= +2.84.
- 726201ae (19 Oct ~05:10): step/hop line with STEP_MARGIN 0.03 (stepReach.ts) in walkingOntoStep AND hopsOver (no
  callback, no headroom check in the hop: a wooden wall post at an L's corner is banded from the boards up and read as a
  ceiling); leanFall/riseOverTakeoff (jumpReach.ts): the drawn height lags over ANY surface running outward (world-y
  damping), added to guard sizing (fence + clause 8) for walk and tops — NOT to the takeoff search (it ladders up lamp
  heads); reachableTops at the census's 60 fps arc (-5.45 cm) and without building owners (castle/hotel/library/
  reptile house): seed 10's reptile coils were a ladder to 5 m.
- 16-seed batch at 0f9c6b78 (/tmp/es-r14): proofs as intended (fence-crate red 128, fence-bush red 62, fences-4m GREEN
  0, drawn-step red, no-crack-rules red 27, narrow-wedges red); seeds 1, 5 green; others had faces at the step limit,
  bush-top lean jumps into boxes (seeds 2, 8, 10, 12, 14, 15), wedged jumps among bush clusters, along-walk hops at
  L corners. Rerun at 726201ae: /tmp/es-r15 (jobs.txt, job.sh).
- Local at 0f9c6b78: check:library, check:exits, check:hotel, check:wall-tunnelling, check:hop-clearance exit 0.

## Round 3, after the RULING CHANGE (19 Oct, Jim): open tracks, the train stops, no taller fence
Coordinator's brief (binding): revert every railway guard height (fence = main's knee-high 0.67 m top, POST_LENGTH
0.95, POST_MIDDLE 0.48, rail centre 0.62; no lifts; bridges = main's look, no railings); tracks open (corridor stays a
closure for NavGrid/NPCs); the train stops for ANYONE on the line ahead (her, her pets, any NPC) — one owner in the
train; never trapped on the line; checks: the census asserts a way off from every line point (red: a fence raised
above her jump), a train clause with her, a pet and an NPC, each proved red. Every OTHER guard stays as is (nursery
glass, planting beds, solid roofs, toilet nook ceiling, narrow-top rule). NO new invisible blocker or guard of any
height without Jim's approval — ask the coordinator (where/why/what it blocks). Stay in scope.
- Done: aea71977 face judged from where her body meets it, head on, by both halves (entryAlong/faceMeetAhead; the
  entry behind her once a step carries her middle over the face); 9cb40c8d/bff45dbc clause 9 room rule (stop excused
  only where nothing taller than a step leaves no room ahead) + obstructed approaches left out + proof feet-judged
  (red on seed 6); 40c59b5b hold never puts her back into a wedge + settlesWedged (30 frame-sized pushes, not one
  long one) in nearestFit/liftOutOfSqueeze/dropWedges; e4c9f326 the railway revert + ParkTrain.keepClearOf/wayAhead
  (stands 1.5 m short, 24 m look-ahead, hardest braking 9 m/s2 only when late, stands for anyone alongside, toots
  once per stop); 12b78c3b check:solids: the line (every 2.4 m point gets off: walk/hop/search; proof sealed-line)
  and clause 8 the train (proofs train-ignores-her/-pets/-npcs); c3a1a97a census landings settle 0.6 s after the
  LAST landing (transient 1-frame wedges were counted). Crowd wiring: NpcSystem.onTheLine (riders excluded), World.
- Seed 5 park at c3a1a97a: all green (census 42 s; the line 89 points, 21 walk + 68 hop; train 1.53/1.49 m short).
- Known, NOT fixed (no new blockers without Jim): under each bridge the parapet walls stand from the ground across
  the arch (main's collider), so walking along the line she is stopped at the bridge's sides and hops out instead.
- Later (19 Oct): 71360688 train places bodies to the cm + tortoise top = crown only (clause 2 reptile house);
  0bd8c921 parapet pieces cut at the drawn parapetLine rings, coping per stretch (clause 2 seeds 0/1/7), the line
  counts as out once leavable (strip beyond the far fence, seeds 1/3/4/7/10), census settles 1.2 s after the LAST
  landing (seed 9's slow escort); 8adc1ea3 crack floor / squeeze lift only onto STANDABLE tops (hotel suite crystal
  tip held her over a pocket: check:hotel probe 33).
- PR head moved to 8adc1ea3 (CI restarted: parks re-solve on the new source hash). Local at 8adc1ea3: seed 5 park+core
  green; check:library/exits/hotel/hop-clearance/wall-tunnelling exit 0 (wall-tunnelling+hop-clearance at 0bd8c921);
  tsc, typecheck:test, flat-primitives, chain-coverage exit 0. Proofs red: sealed-line, train-ignores-her/-pets/-npcs,
  drawn-step, feet-judged (seed 6), no-crack-rules, narrow-wedges.
- Known, not fixed (report): seeds 6 and 11 stall awnings (Jim's call; seed 11 from a bridge parapet coping); seeds 9
  and 11 one walk-off each into a slot between a wall and taller bushes (0.1 m squeeze; the hold asks her column, not
  her walk on); seed 15 bench lean (since round one); the parapet-under-the-arch blocker (main's).
- Preview repro script: /tmp/es-qa/repros4.mjs (window.game only on a dev build: on a preview it waits a lap and
  screenshots). Local dev run: train stopped 1.53 m short, resumed after she hopped off; 0 page errors.
- Drafts: PR body /tmp/es-pr-body4.md (placeholders @@PREVIEW@@ @@PROOFS@@ @@CENSUS@@ @@IDENTITY@@), comment
  /tmp/es-pr-comment4.md (@@HEAD@@ @@CI@@ @@SEEDS@@ @@PREVIEW_ROOT@@ @@PLAYS@@).
- DONE (19 Oct, ~11:00 UTC): PR head 8adc1ea3, CI run 39231055387 success (88 jobs); parks identical to round two's
  (restart/features/planOrder/measures, 16/16; artifact parks-17418cb6…, /tmp/es-parks-r3b). Preview
  https://pr-722-8adc1ea-land-of-good-places.blockstack.workers.dev — repros played (train stopped short and went on;
  knee wall z 59.6->67.6; armchair moved 0; wall-and-bush 0 blinks; 0 page errors); frames on qa-screenshots/pr722-r3b/
  (commit 9b3a0b2f). PR body updated (/tmp/es-pr-body4.md); comment issuecomment-6265606013.
- Sixteen parks at 8adc1ea3: 12 green; red 6 (awning), 9 (walk-off squeeze), 11 (awning + walk-off squeeze), 15 (bench).

## Round four, restart (23 Oct 2026 from 04:40 BST, Opus 5.5) — resume here
**STATE at 08:15 BST**: PR head `feat/engine-solids-pr` = **fccadf8b**; CI run **39911387184: success** (Checks + Procgen
invariants green, every seed builds, entrance road, coplanar, swept bus, walk reach, PR preview; park jobs skipped on a
cache hit from run 39905508749, restarts 0:3 1:1 2:3 3:7 4:1 5:1 6:1 7:5 8:1 9:0 10:9 11:4 12:0 13:6 14:8 15:4 at source
7acd3093); Update adoption 39911387195 success. Preview https://pr-722-fccadf8-land-of-good-places.blockstack.workers.dev
PR body rewritten for round four (decisions 1–7 as questions for Jim, invisible blockers, proofs, the 16-park table);
comment issuecomment-6359285799 (plays + frames, qa-screenshots a54af1ce `pr722-r4/`). The work branch is ahead of the PR
head by handoff commits only. NEXT: one combined review + QA pass on fccadf8b, then Jim's yes and the merge.
**Plays on that preview** (`/tmp/es-qa/plays9.mjs`, frames `/tmp/es-qa/r9/`, every frame opened): 1 fence hop, the train
stood short of her and her pet 10 s → 120 s, hopped off, it went on; 2 the tunnel walked through (−19.6,54.3 → −19.8,40.4);
3 `?pets=3`: Get on at Sunny Side, a 72 s lap, Get off at Sunny Side, off at the stand (first person cannot show her
backpack; the counts are clause 8's / check:exits'); 4a on the line ahead of Bluebell Halt, it stood short, she walked
2.0 m into its nose and stopped, 0.0 m more pushing; 4b stood on carriage 2 at Bluebell Halt 15 s, the train waited;
back on the platform, **her pet had followed her onto the carriage and stayed in it, and the train waited for it** (by the
rule; decision 6 asks Jim). A replay of 3 (`/tmp/es-qa/r9b`) stuck her at a canopy post off the platform's corner
(−19.0, 13.7): "Get on" showed there but did nothing — main's requestBoard asks she stands on the platform; play-script
walking, not a regression.
The Fable agent below died after its gate run at bf7b1c8b (04:32) without recording it; its orphaned servers (vite preview
5737, dev 5738, both PPID 1, in this worktree) were killed by PID at 04:43.
- Verified at bf7b1c8b: all nine check shards exit 0 (`/tmp/es-sh-r5-*.log`, snapshot worktree; clauses 8 and 13 all ✓,
  check:exits companions on 13 holders, check:pet-slide one companion); test:procgen exit 0 (46 files, 2154 passed, 0 skipped,
  250 s); build exit 0. origin/main has not moved (d7fde7bd = merge base).
- PR head moved 8e8d318a..bf7b1c8b (fast-forward) at 04:53 BST. CI run 39897430858: **success** (88 jobs success, 1
  skipped: Deploy); Update adoption 39897430909: success. Parks at source 581ed3c1: restarts 0:3 1:1 2:3 3:7 4:1 5:1 6:1 7:5
  8:1 9:0 10:9 11:4 12:0 13:6 14:8 15:4 — round three's, unchanged. Preview https://pr-722-bf7b1c8-land-of-good-places.blockstack.workers.dev
- Played on that preview (`/tmp/es-qa/plays7.mjs`, frames `/tmp/es-qa/r7a/`): the fence hop and the train standing short
  of her and her pet, then going on once she hopped off; the tunnel walked through (-15.0,53.8 → -19.9,40.7); the ride's
  "Get off" click landed on a chip fading out as the train came in, so she rode on (a play-script bug: plays8.mjs waits
  for a drawn chip and a train standing a second); the jump meant to land on carriage 1 at Sunny Side carried her over
  it to the far side (plays8.mjs walks into carriage 3 instead: its rim is 0.45 m over the platform, a step).
- **906510e8 (code) gate, local**: nine shards exit 0 (`/tmp/es-sh-r7-*.log`, snapshot), test:procgen exit 0 (46 files,
  2154 tests, 274 s), build exit 0; clauses 8/12/13 on all 16 parks: 15 green, seed 6 one line (`/tmp/es-seeds13`);
  the 11 train proofs red at 906510e8 (`/tmp/es-proofs12`, riders-sit-on-her on seed 2).
- **PR head moved bf7b1c8b..1655d287 at 06:23 BST**; CI run 39905508749 (+ Update adoption 39905508638). ParkTrain.ts is
  in the parks' source closure, so CI re-solves all 16.
- Plays: `/tmp/es-qa/plays9.mjs` (lib `/tmp/es-qa/lib.mjs`, coordinates from `es-r7-geom.mts`, untracked scratch):
  1 fence+train (west stretch), 2 tunnel, 3 ride with `?pets=3` (frames in the open off Sunny Side's canopy; "Get off"
  only once a drawn chip and a train standing a second), 4a walk into the nose at Bluebell Halt (on the line 3.5 m
  ahead of where it stops), 4b stand on carriage 2 at Bluebell Halt (the platform is level with the rims there).
  Calibrated on bf7b1c8's preview: 3 rode a lap and got off; 4b stood on carriage 2, the train waited 10 s.
- Full census on all 16 parks at 906510e8 (`/tmp/es-census13/<seed>.log`): green 0 1 3 5 7 8 10 12 13 14; red 2 and 4
  (one run-and-jump wedge each) and 11 (three new + the known walk-off), all between the fence and the train's carriages
  standing where the park was built — none there at 8e8d318a (seed 11 at 8e8d318a: only the known walk-off). Fix
  b78789c6: the static clauses ask the park without the train (its bodies stood out of the park until clause 8's first
  frame; ParkTrain.moveBodies puts them back every frame). After it: seeds 2, 4, 5 green, 11 back to the known walk-off,
  core OK. Known, unchanged: 9 and 11 walk-off squeezes, 15 bench lean, 6 carriage rim (decision 7).
- Full census on all 16 at b78789c6 (`/tmp/es-census15/<seed>.log`, `--part=park`, census on): 12 green; red 6 (the carriage
  rim, decision 7), 9 and 11 (the walk-off squeezes since round three), 15 (the bench lean since round one).
  Census proofs re-run red at b78789c6 (`/tmp/es-proofs13`): no-crack-rules 25 wedged, sealed-line 59 points with no way
  off, stranded, low-roof; train-ignores-on-top and riders-sit-on-her (seed 2) too.

| seed | tops | regions | the line: points (walk / hop / tunnel / search) | wall faces | tunnels | stops short on the loop (m) | result |
|---:|---:|---:|---|---:|---:|---:|---|
| 0 | 753 | 150 | 85 (24 / 59 / 2 / 0) | 161 | 1 | 1.44 | green |
| 1 | 798 | 158 | 73 (25 / 46 / 2 / 0) | 270 | 1 | 1.47 | green |
| 2 | 822 | 176 | 77 (23 / 52 / 2 / 0) | 257 | 1 | 1.42 | green |
| 3 | 721 | 146 | 102 (25 / 75 / 2 / 0) | 157 | 1 | 1.58 | green |
| 4 | 751 | 119 | 83 (26 / 55 / 2 / 0) | 122 | 1 | 1.44 | green |
| 5 | 722 | 156 | 89 (25 / 62 / 2 / 0) | 181 | 1 | 1.54 | green |
| 6 | 785 | 165 | 102 (26 / 74 / 2 / 0) | 180 | 1 | 1.51 | red: the carriage rim at the step's limit (decision 7) |
| 7 | 721 | 156 | 85 (23 / 60 / 2 / 0) | 142 | 1 | 1.38 | green |
| 8 | 816 | 157 | 93 (24 / 67 / 2 / 0) | 152 | 1 | 1.40 | green |
| 9 | 797 | 154 | 87 (24 / 61 / 2 / 0) | 213 | 1 | 1.47 | red: 1 walk-off squeeze (since round three) |
| 10 | 715 | 161 | 110 (25 / 83 / 2 / 0) | 177 | 1 | 1.67 | green |
| 11 | 784 | 142 | 69 (26 / 40 / 3 / 0) | 291 | 1 | 1.42 | red: 1 walk-off squeeze (since round three) |
| 12 | 798 | 170 | 103 (25 / 76 / 2 / 0) | 271 | 1 | 1.63 | green |
| 13 | 856 | 178 | 88 (22 / 64 / 2 / 0) | 212 | 1 | 1.64 | green |
| 14 | 766 | 157 | 93 (22 / 69 / 2 / 0) | 197 | 1 | 1.45 | green |
| 15 | 798 | 169 | 108 (27 / 79 / 2 / 0) | 169 | 1 | 1.62 | red: the far station bench, 0.20 m (since round one) | Plan: when run
  39905508749's "Parks / Parks" finishes, move the PR head to b78789c6+ (check-only: same park source hash 7acd3093…,
  so the new run takes the parks from that one), then play plays9.mjs on its preview.
- **The previous CI run, 39249030666 on 8e8d318a, FAILED and nobody recorded it**: 14 of 16 seeds solved no park ("no block
  accepted a restart (restarts 0..63 all rejected)"; only 5 and 15 built), so Procgen invariants and Checks failed for want
  of parks. Cause, from the block logs: seed 0 restart 3 (main's) "rejected by check:park rail.walkable" — the tunnel commit's
  bug that 5dffa34e fixed (a route ending on a deck over the tunnel mouth read as the track reached). Watch run 39897430858's
  park blocks: each restart prints "rejected by <check>".
- **Every proof red at bf7b1c8b** — 38 runs, `/tmp/es-proofs11/run` = `one.sh` + `jobs.txt` (7 at a time, 976 s), in the
  detached worktree `.claude/worktrees/engine-solids-proofs` (bf7b1c8b, `.parks` copied + restamped). All exit 1, each on its
  own clause (lines below). The pet-slide reds are a scratch wrapper there, `scripts/es-proof-petslide.mts` (never committed),
  that breaks `Parade.embark`/`disembark` as check:exits' proofs do, then imports check-pet-slide.
- Seed 6 (seen in the feet-judged proof run, census on): clause 8 "✗ once her line has followed her off it, the train goes on
  past where they stood — it never did in 40 s" and clause 13 "✗ walking into it standing at Sunny Side … at the carriage
  197.5 m round: 0.03 m inside it". Not from the mutation (it touches only the census sim). CI's chain runs seed 5 only.
- **Clauses 8 and 13 on all 16 parks** (census skipped, `/tmp/es-seeds11/<seed>.log` at bf7b1c8b): red on 10 (0 1 3 4 6
  7 8 10 13 14). Diagnosed one by one (failure messages now carry who holds the train, where she walked, her put-down):
  one game defect — a boarding child took the seat in the carriage she stood on and, as furniture to her, shouldered
  her off the far side (seed 2, once the others were fixed) → `ParkTrain.upOn` in `claimSeat`, proof `riders-sit-on-her`
  (seed 2); the rest the clauses' own choreography (her hop-out blocked a metre past the fence; a slantwise walk off a
  carriage's end; the holder 3 m ahead letting the train creep into her; wedges measured from the walk sampler while
  she stood on a carriage's top; her line left at her trail's point beside a carriage). Commit 906510e8. After it:
  15 of 16 clean (`/tmp/es-seeds12`, census skipped); **seed 6 still red** — see the next item.
- **Seed 6, Sunny Side, the carriage 197.5 m round (KNOWN GAP, not fixed)**: the carriage's rim stands 0.576–0.595 m over
  the platform there (its tilt on the planet), straddling the step's limit (0.62 − 0.03 = 0.59). Walking into its side she
  starts up onto it (0.13 m in, frames 15–19, at 0.576), then is set back 0.23 m in one frame and stands pressed at 0.594
  (not a step). The clause sees 0.031 m inside it on the frame at 0.5906. Platform 0.34 m and rim CAR_FLOOR_Y + 0.48 =
  1.06 m put every carriage within a centimetre or two of the limit on every park; only the lean decides. A visible
  change to either height is Jim's call — question for Jim in the PR body.
- The 38 reds at bf7b1c8b (geometry: seed 5's park, source hash 581ed3c1…, CI's parks restamped; feet-judged on seed 6;
  round-four train proofs with SOLIDS_SKIP_CENSUS=1, the rest with the census; core = the buildings):
  - `solids-train-ignores-her`: ✗ at every station (2 of 2): on the line 2.2 m past its nose as it waits, the train stays at least her own width (1.24 m) short of her and stands the 14 s — Sunny Side: it stays 1.08 m short of her and stands 12.8 s of 14; Bluebel
  - `solids-train-ignores-pets`: ✗ her line on the line: 2 of her companions left on the track behind her as she hopped the fence, the train comes up and stops -39.23 m short of the nearest (1.24 asked), standing 4.0 s
  - `solids-train-ignores-npcs`: ✗ a child of the crowd: 20 m ahead of it, through World's own wiring, the train stops -23.07 m short of them (1.24 asked), standing 8.0 s
  - `solids-platform-holds-train`: ✗ at every station: up on the platform where its chip stands her, with her line about her, it leaves — Sunny Side: with her on its platform at (-20.7, 14.2) it never left in 20 s (3 of her line on the line); Bluebell Halt: it never came to stand there (its nos
  - `solids-pets-count-aboard`: ✗ the ride, with her 3 pets out: aboard, 1 beside her and 2 in her backpack; it left in never, went 0 of its 212 m lap and never offered "Get off"; she could NOT get off, 1 of 3 back out (1 on the line or in something), and it wen
  - `solids-pets-stay-out`: ✗ the ride, with her 3 pets out: aboard, 0 beside her and 0 in her backpack; it left in never, went 0 of its 212 m lap and never offered "Get off"; she could NOT get off, 3 of 3 back out (3 on the line or in something), and it wen
  - `solids-ghost-train`: ✗ walking into it standing at Sunny Side, from the platform at 3 carriage(s): she bumps its side, or steps up onto it where the platform is a step below its rim — never inside it, never through it — at the carriage 34.6 m round: t
  - `solids-frozen-train`: ✗ walking into it standing at Sunny Side, from the platform at 3 carriage(s): she bumps its side, or steps up onto it where the platform is a step below its rim — never inside it, never through it — at the carriage 34.6 m round: t
  - `solids-train-ignores-on-top`: ✗ standing on it: put on carriage 2 at Bluebell Halt (at Sunny Side, nowhere beside the platform with room for her and no child of the crowd in it) (on its top, -15.93), it moved 1.31 m in 30 s; she stepped off onto the platform, 
  - `solids-put-down-ignores-train`: ✗ put down beside it: 9 exits asked inside it, in the slot beyond it and between its cars at Bluebell Halt — none puts her inside it or wedged, as put down or a second later — in the slot beyond the carriage 106.9 m round: put dow
  - `exits-pets-stay-out`: ✗ her companions on the Rail Race: 3 of her 3 out, 0 in a seat beside her — wanted one out, in its seat beside her, the rest in her backpack
  - `exits-pets-stay-in`: ✗ the cat bus, ridden to the gate (10 s): only 0 of the 3 of her line out before the ride came back out of her backpack
  - `exits-pets-count-aboard`: ✗ the train: with her aboard and her line out, it never left the platform (15 s allowed)
  - `petslide-pets-stay-out`: - line: 3 of her 3 companions were out on ridden frame 121, against 1 — the front of her line rides, the rest in her backpack
  - `petslide-pets-stay-in`: - regroup: 1 of her 3 companions were out 3 s after the ride — the rest never came back out of her backpack
  - `solids-infinite`: ✗ 3716 solids, 3715 with a real top, 1 without one: proof: a pillar with no top [relative top] ×1
  - `solids-too-tall`: ✗ a castle bench (top 0.44 m): no run at it from any side came down on it
  - `solids-trap`: ✗ the castle's mall: every one of 3 region(s) she can drop into, she can get out of again — trapped: a hop over crate from (585.4, 612.1) → /castle?deck=0&at=-16.9,9.7&seed=5
  - `solids-ghost`: ✗ 408 marches at 16 new kinds of solid: 15 got a body into one below its top:
  - `solids-no-bounds`: ✗ 256 bodies pushed 12 m outward at 64 bearings, from the grass to 10 m up: 206 got past the edge — 0° at 0 m up: -1.89 m from the edge; 0° at 1.5 m up: -6.70 m from the edge; 0° at 4 m up: -9.37 m from the edge; 0° at 10 m up: -9
  - `solids-new-roof`: ✗ 14 kinds named like a roof in the built park and its buildings: 6 roofs the census asserts, 4 open-air canopies (ordinary tops), 3 not roofs, with their reasons — and 1 neither: proof: a garage roof
  - `solids-narrow-wedges`: ✗ the library: no jump or walk-off of 687 leaves her wedged — 2: a run-and-jump from (-586.08, 0.00, -605.77) at (-586.08, -609.16), jumping 2.22 m out, came down at /library?at=13.6,-9.3&seed=5; a run-and-jump from (-596.68, 0.36
  - `solids-single-step`: ✗ 532 pushes into the tops she steps up onto, 8 bearings each: 165 stood her on the top, 316 walked her across it or held her at its face, 51 shuttled her — fireside bench in the castle's great hall from (890.1, 589.0): 8 swings i
  - `solids-drawn-feet`: ✗ 532 pushes into the tops she steps up onto, 8 bearings each: 168 stood her on the top, 298 walked her across it or held her at its face, 66 shuttled her — roof trough in the castle's roof garden from (1185.2, 588.2): 8 swings in
  - `solids-sealed-line`: ✗ the line: from every one of 89 points along it, 2.4 m apart on the track bed, she gets off it again (17 walking, 1 with a hop over its fence, 11 walking along it — through a tunnel — and hopping off, 60 by her own search) — 59 w
  - `solids-parapets-to-ground`: ✗ 1 tunnel(s) under 1 bridge(s), walked both ways along the line's middle: 2 stopped, wedged or through the soffit — the tunnel at 209.5–2.2 m round the loop, walked with the train from /spawn?pos=-18.0,53.8&seed=5: stopped after 
  - `solids-drawn-step`: ✗ 181 faces of 66 hoppable walls, both sides, every metre (67 a step high, 114 a hop), each walked into at a walk and a sprint on 6 frame clocks: 2 stopped her dead — stone garden wall at (-50.0, 61.6), 0.49 m over where she meets
  - `solids-feet-judged`: ✗ of those a step high, 2 hopped her over instead of stepping up — stone garden wall at (21.9, 0.5), 0.59 m over where she meets it, from /spawn?pos=21.9,-1.7&seed=6 (60 fps); stone garden wall at (22.9, 0.5), 0.58 m over where sh
  - `solids-no-crack-rules`: ✗ the park: no jump or walk-off of 36783 leaves her wedged — 25: walking off stone garden wall at (-36.15, -11.00), came down at /spawn?pos=-35.6,-3.31,-11.6&facing=72&seed=5; a run-and-jump from (-35.90, -2.89, -10.47) at (-39.90
  - `solids-tall-top`: ✗ 345 landings on solids measured against the drawn scene: 1 more than 0.15 m off the drawn top, by kind:
  - `solids-low-roof`: ✗ the park: no roof reached — 1: the castle's roof, e.g. /spawn?pos=1.9,-6.04,52.1&facing=-178&seed=5
  - `solids-low-exhibit`: ✗ the park: no enclosure reached — 1: proof's enclosure, e.g. /spawn?pos=1.9,-6.04,52.1&facing=-178&seed=5
  - `solids-stranded`: ✗ the park: every one of 159 region(s) she can drop into, she can get out of again — trapped: a hop over proof: the ring round the pit from the top of bridge parapet → /spawn?pos=-1.5,-3.50,43.3&facing=178&seed=5
  - `solids-no-headroom`: ✗ 722 reached tops: 1 with something over them lower than her head — e.g. dodgems tree at (-50.8, 36.5)
  - `solids-reptile-roof`: ✗ the park: no roof reached — 1: the reptile house's roof, e.g. /spawn?pos=1.9,-6.04,52.1&facing=-178&seed=5
  - `solids-every-roof`: ✗ the park: no roof reached — 6: the castle's roof, the library's roof, the reptile house's roof, the roof garden pavilion's roof, a roof garden turret's top, a hotel bathroom nook's roof, e.g. /spawn?pos=3.5,-5.96,51.6&facing=-17
  - `solids-blind-hop`: ✗ 68 walks along 338 wall tops and rims she reaches, end to end at a walk: 33 hopped her off — along wooden garden wall in the park from (-23.9, -36.2): hopped off at (-23.9, -36.2); along stone garden wall in the park from (-51.9
  - `solids-spawn-highest`: ✗ 3163 spawn points over 7 kinds of roof (reptile house roof, library roof, stall parasol, castle roof deck, stall awning, station canopy, bus shelter canopy): 3163 stood her on one — reptile house roof at /spawn?pos=46.1,-2.7&see

## Round four finished (22–23 Oct 2026, Fable 5.1)
State: work branch feat/engine-solids at bf7b1c8b (see the restart section above for the PR head, CI and preview).
Local parks: `.parks` hydrated with CI's seed 0–15 parks, restamped to the tree's hash by `/tmp/es-restamp-current.sh <worktree>`
(a stale manifest makes every harness hang at 0% CPU — restamp after ANY src edit). Gate runner: `/tmp/es-shards5.sh <tag> 1..9`
runs the nine shards in parallel in the detached snapshot worktree `.claude/worktrees/engine-solids-snap` (never edited; checkout
--detach the commit, copy .parks, restamp). Proof batch: `/tmp/es-proofs10/run.sh solids|exits` (logs alongside, head.txt).
Done this round (each its own commit, pushed):
- 5edb5b81 the census (lib/solidReach.mts) leaves the train's 15 moving bodies out (neither aimed at nor hopped over);
  clauses 5, 9, 10 and the jet-pack report too; the stderr note names every clause they are out of. Clause 8 asks EVERY
  station: on the line 2.2 m past the nose it stays; then up on the platform at the chip's spot it leaves within 20 s. Proof
  `platform-holds-train` (her platform counted as the line). The "her line on the line" case hops out square across the line
  (the old "away from the middle" was the position vector, which on a radial stretch walked her along the track). Clause 13
  lets go of its holder NPC when it finds nowhere to stand on the train (its own bookkeeping had failed the later cases).
- 8a48066b DECISION (Jim away; question for him in the PR body): a player standing still is furniture to the crowd —
  `Player.isStandingStill` (one owner), `NpcSystem.separateFromPlayer`: the child takes the whole correction. Reason: at a
  platform the crowd walking to its waiting spots (1.28 m from the stand spot, inside the 1.52 m separation) pushed her a
  metre across the platform in 10 s to within 1.18 m of the line; the train, which stops for anybody in its way, stood
  1.5 m short of the station for her, then she was pushed off the platform's edge onto the track. Found by clause 13
  "put down beside it" — green on one run, red on the next (phase of the lap), so flaky = failing, fixed at the root.
- 7ce1deae clause 13 asks the put-down spot AS CHOSEN (the rule's own answer must be clear of the train), not a second later
  when the resolver/wedge rescue may have mended it — proof `put-down-ignores-train` was red at Bluebell Halt and green at
  Sunny Side before. `scripts/trace-npc-driver.mts` (check:crowd, shard 1): its stub `TrainStop`s had no waitX/waitZ since
  3443b9e8 → every walk aimed at NaN → "NOT EXERCISED: trips" (CI shard 1 would have been RED). Fixed; trips=76.
- (this commit) `Player.ts` hover rescue: `p.y - this.hoverAt.y` was a new flat primitive (check:flat-primitives RED in
  shard 1, from 97444d7f) → `altitudeAt` difference. check:jitter RED (shard 3, pre-existing since 3443b9e8/4715101a): a
  waiting child (Theo, Sunny Side) was shoved off the platform onto the track by children walking to the SAME waiting spot
  (PLATFORM_ARRIVE 0.6 → two cannot both arrive; the first there got half the overlap a frame: 2.6 → 1.17 m from the line
  in 1 s, off the edge at f1910), then after 3 s `offTheLine` set him down 2.74 m away in one frame — an "own step" of
  2.743 (bound 1). Fixes: (a) each platform has TWO places to wait (`TrainStop.waits`, a child's width apart on the open
  end, far one first; `Station.WAIT_ALONGS` 2.7 and 0.9 — the nearer is 1.0 m from the chip's stand spot, so a child
  walking up to it while the player stands there is held 1.52 m from her, 0.5 m short of the spot, inside the 0.6 m
  arrival radius: she waits there instead of walking into the player's back for a minute), one child to a place
  (`TrainService.claimWait/releaseWait`; the trip claims at commitment, releases on boarding/abandon; full → no trip
  this time); (b) a waiting child holds her
  ground (`GroundHolder.holdsGround` on the driver, `NpcCharacter.holdsGround`; furniture in `separateFrom` and to the
  walking player); (c) the set-down is a declared write `NpcCharacter.setDown` (via stepThroughDoor), hooked by
  check:jitter like stepThroughDoor. check:labels RED (shard 4) after 8a48066b: a crowd path change surfaced a label
  flicker — Jasper's name pill came up 3 px below Wren's (older incumbent), drifted into it at 1 px/frame, went down 11
  frames later (D). Fix in `LabelManager`: `LABEL_ENTRY_CUSHION_PX` 24 — a label comes up only with that much room beyond
  the margin, stays up to the margin (rule 3's hysteresis on the way up); check:labels' C clause asks the same room for a
  label that was down. Sanity: with the standing-still rule disabled check:labels was green, so the flicker is path-
  sensitive, not a manager regression — the cushion fixes the class.
Local gate at 7ce1deae (snapshot, /tmp/es-sh-r4-*.log): shards 2,5,6,7,8,9 exit 0; 1 (flat-primitives), 3 (jitter), 4
(labels) red as above → fixed in the next commit; re-run recorded below. test:procgen exit 0 (46 files, 2154 tests); build
exit 0; tsc exit 0; check:exits/pet-slide/solids core+park (census) exit 0 at 8a48066b.
Red proofs at 8a48066b (/tmp/es-proofs10, SOLIDS_SKIP_CENSUS=1 LGP_SEED=5; the two census-skipped clause-9/11 "0 walks"
lines are red in every skip-census run and are not the proof):
- platform-holds-train: ✗ at every station: … it leaves — Sunny Side: with her on its platform at (-20.7, 14.2) it never
  left in 20 s (3 of her line on the line); Bluebell Halt: it never came to stand there (its nose at 40.8 m round)
- train-ignores-her: ✗ at every station (2 of 2): Sunny Side 1.08 m short, Bluebell Halt 0.99 m short (1.24 asked);
  ✗ on the loop 1.03 m; ✗ in a tunnel (209.5–2.2 m round) 1.00 m
- train-ignores-pets: ✗ her line on the line: … stops -39.23 m short of the nearest; train-ignores-npcs: ✗ -23.07 m
- train-ignores-on-top: ✗ standing on it: carriage 2 at Sunny Side, it moved 1.38 m in 30 s
- pets-count-aboard / pets-stay-out: ✗ the ride … it left in never, went 0 of its 212 m lap
- ghost-train / frozen-train: ✗ walking into it standing at Sunny Side … carriage 34.6 m round: through to its far side
- put-down-ignores-train (at 7ce1deae): ✗ put down beside it … slot beyond the carriage 34.6 m round: put down 0.76 m
  inside it, wedged 0.76; 31.6 m round: 0.31 / 0.31
- exits: pets-count-aboard ✗ the train never left the platform (15 s allowed); pets-stay-in 18 FAILED exits (companions
  missing); pets-stay-out ✗ her companions on the Rail Race/coaster/ferris/slide/lift: 3 of 3 out, 0 in a seat
Questions for Jim (also in the PR body): (1) a child standing still is not shoved by the crowd — keep? (2) two places to
wait per platform, one child each (a third wonders again later) — keep? (3) the label entry cushion (24 px) — keep?

## PAUSED 19 Oct 2026 (Jim: token usage at 92%) — superseded by the section above
- The engineer was stopped mid-task; the worktree was clean and everything is pushed (feat/engine-solids @ 23680ecf).
  PR #722's head (feat/engine-solids-pr) is still 8e8d318a, which predates round four. The tunnel commits and all
  of round four are unverified by QA.
- Was doing: "the every-station case and its proof" for check:solids clause 8 (see the Round four section).
  Proof batch script: /tmp/es-proofs9/run.sh (logs may not survive a reboot; re-run it).
- To finish:
  - round four's TODO list below: the census excludes moving bodies; the clause-8 every-station case;
    every proof red;
  - the local check, test:procgen and build;
  - move the PR head (feat/engine-solids-pr) and get CI green;
  - one combined review+QA pass on the new head, covering the tunnel walk (a deep link just before a bridge),
    boarding the train with 3 pets (one beside her, two in the backpack), a lap, getting off, walking into and
    standing on the stopped solid train, plus round three's fixes;
  - then Jim's yes and the merge.
- Jim's rulings on this PR are all recorded as PR comments. Two that bind:
  - "maybe check with me first": no new blocker or guard without asking him;
  - "I just don't want the world to feel fenced in with tall fences".

## Round four (19 Oct, afternoon): pets on rides + solid trains (coordinator BLOCKER + Jim's rulings)
- Jim: "all the pets except one jump into her backpack on getting on any ride, then one rides on the seat
  alongside the player"; "also solid trains". Longer trains DROPPED (next PR, not ours).
- Owner: Player.beginRide/endRide -> Player.watchRides listeners -> Parade.rideChanged (embark/disembark).
  RideHolder.companion: CompanionRide = {beside(seat)} | 'carried by the ride' | 'drawn by the ride' |
  'in her backpack' | 'not a ride'. Front of her line (members[0]) = companion. Rest leave the line via sync()
  filter (poof = existing stow animation, peek from backpack), never written to the save. Disembark: formUpBehind
  seeds the trail on the longest clear run (8 bearings, 7 m, off solids/closures/bounds/the line via
  parade.keepOff = train.onTheLine).
- Seats: train = COMPANION_SEAT 2 (carriage 1 rear bench, behind her; children never take it; still 4 kids);
  Rail Race = cart pet perch (cart.ts petPerchTop); tortoise = shell 0.75 m behind her (raycast); lifts = 0.8 m
  behind her in the car (liftCompanion.ts); ferris = gondola middle chair (createGondola(frontOfLine uid));
  giant slide = chute behind her (unchanged ridePetsDownSlide); Sky Cruiser, cat bus, little slides = backpack;
  chairs/bed/banquet/views/tree/keychain rack = 'not a ride'.
- Train: lookout in ParkTrain (player via attachPlayer, parade via attachParade; World.attachParade wires hotel,
  building, train, ferris, keepOff). Game's keepClearOf block REMOVED. On the line = within TRACK_CLEARANCE+r
  of the line (platform: CARRIAGE_BODY_HALF_WIDTH+0.1+r); stoppedStop held until the train actually moves
  (Get off always offered while it stands); toots again every 4 s while held.
- Solid train (f9d17f4e): CollisionWorld.addMovingBox/moveBox (banded, wide bucket, no revision bump). Pieces in
  ParkTrain ENGINE_PIECES/CARRIAGE_PIECES (carriage = lid at rim 1.06 + 2 backrests; separate rims left a 4 cm
  landing target). NPC riders set down on the platform beside their seat (carryPassengers aboard map); a rider
  is furniture to her in NpcSystem.separateFromPlayer.
- Scratch: es-ride.mts (3 pets, lap, off: OK seed 5), es-solid.mts (walk into stopped 1.423 m; holds pressed;
  on top holds; leaves after), es-slot.mts (slot drops freed). Station canopy caps her jump under it (correct).
- TODO: census excludes moving bodies; check:exits every holder with 3 pets (one beside, rest stowed, ride runs,
  off, all back free); check:solids clause 8 via real wiring + solid-train clauses; proofs red; fix
  check:pet-slide (one pet now); run check/test:procgen/build; PR; preview plays.
- Later (19 Oct pm): 5dffa34e check:park rail.walkable is level-aware (pre-existing from the tunnel commit
  4687a570: a route ending on a deck 1 m over the tunnel mouth read as the track reached; control: a 6 m fence+
  corridor gap -> 11 points). 3443b9e8 children wait at Station.waitX (open end, back half, arrival 0.6 m ->
  >= 2.0 m from the line); parade force-resync uses signature null ('' == empty line, so the last never stowed);
  form-up on her floor; check:pet-slide = one companion rides, two in backpack, all back out.
- Platform reach: ahead of the train PLATFORM_AHEAD (cab eaves 0.92 + 0.08) + r; BESIDE a standing train only a
  body whose middle is inside 0.8 (up on a carriage) — an NPC idling at a platform edge at 1.25 m held the train
  for minutes (check:exits "never stood at a platform she could board", check:solids ride case).
- check:exits (uncommitted at this note): 3 pets; World.attachParade; watchCompanions asks every holder 0.3 s
  in (13 holders), companionsBack after every judge; 4d: cat bus to the gate, Rail Race (chooseLevel(1)), Sky
  Cruiser, ferris to their ends, the train a whole lap + Get off + it leaves; Next day judged by followDistance
  (check:exits never ran store microtasks, so wild-caught pets never joined the line before; my explicit
  sync made them join -> line of 6-7). PASSED at 3443b9e8+edits.
- check:solids clause 8 rewritten through Game's wiring (real Player+Parade, attachPlayer/attachParade), margin
  = 2*PLAYER_RADIUS; clause 13 solid train. Proofs added: pets-count-aboard, pets-stay-out, ghost-train,
  frozen-train, train-ignores-on-top, put-down-ignores-train (+ train-ignores-her/-pets(M5: parade null)/-npcs).
- Later still (19 Oct evening): 97444d7f hover rescue (airborne >= 1 s within 0.5 m, not flying -> teleportTo
  through the put-down rule: the 0.42 m slot between cars ping-ponged squeeze lift <-> resolver; NO invisible
  coupling blocker added, per Jim's rule); riders giving up a seat on the last stopped frame are set down at the
  NEAREST platform; PLATFORM_BESIDE = body middle inside 0.8 (touching its side never holds it). 4715101a
  NpcSystem.offTheLine: a crowd child on the line 3 s is set down off it (TrainService.downOnTheLine/wayOff).
  9e67c505 check:exits companions on every holder + every ride ridden to its end (+ EXITS_PROVE in 01d1a06a).
- 01d1a06a check:solids clauses 8 + 13 committed. Seed 5 park (SOLIDS_SKIP_CENSUS=1, 27 s): 8 and 13 all green.
  Standing on it: only a carriage's MIDDLE fits her (backrests 0.70 m either side, she is 0.62); a seated rider
  shoulders her off (separateFromPlayer: rider = furniture), Sunny Side's free carriage is under the canopy, so
  the clause waits for a stop with a free carriage beside the platform (seed 5: Bluebell Halt, carriage 2).
- Proof batch: /tmp/es-proofs9/run.sh (9 solids park proofs + 3 exits proofs, logs alongside).
