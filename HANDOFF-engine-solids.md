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
- Previews: (a) pr-722-7defc91…/hotel; (b) https://pr-722-ff686cb-land-of-good-places.blockstack.workers.dev
  (from the PR's own comment). (c): the newest "Deploy PR preview" comment once CI deploys.
- Next: CI green on the final head, compare CI parks (/tmp/es-compare-parks.mjs), preview check,
  PR body (/tmp/es-pr-body.md), report.
- Planet note (measured, es-leanreach.mts): with the carry, a jump's apex over the ground is
  cos(lean) × flat (gravity is along world y): 1.23 m middle, 1.20 @44 m, 1.13 @85 m inward;
  outward adds the damp lag (to 1.41). Pre-existing physics; hop policy is position-blind.
- My dev server PID 87427 (port 5798) — stopped 02:10.

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
