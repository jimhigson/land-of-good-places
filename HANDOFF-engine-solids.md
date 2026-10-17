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

## Status
- [x] (a) switch-over — DRAFT PR #722, head `feat/engine-solids-pr` = 7defc913. Local gate on the
  snapshot: check 0, test:procgen 0 (46 files, 2154 tests), build 0. Looks: /tmp/es-look/shots-a/.
  CI run 39032883089: 89 pass, Deploy skipped (PRs). CI's 16 parks vs main's: restart, features,
  planOrder, digest, measures all identical on 16/16. Preview:
  https://pr-722-7defc91-land-of-good-places.blockstack.workers.dev (+ /hotel: sofas are steps now).
- [~] (b) real heights + census. Done (each family named + kinded, meshes byte-identical, digests 16/16):
  garden walls, fountain, railway fence, stall booths, dodgems (+posts), ferris (legs, step-up deck,
  railings where drawn), water fight (pool rims, hedges, sprinkler, rack), lamps, fairy poles, trees,
  bushes, cruiser pylons, rail race trestles, slide legs, gate piers, welcome sign posts, bus shelter
  (posts, NEW bench + canopy), stations (posts, NEW bench + awning).
  Also done: boundary wall + pillars, castle (storeys, battlement, pavilion, turrets, curtain wall,
  towers, shop counters, NEW decor solids: crates/woodpile/troughs/dais/throne/armour/chest/fireside
  bench), hotel (walls, partitions, stair flanks, balustrades, tower, locked door), library (shell,
  plinth edges w/ TopSlope, room walls; no 'wall' PropTop), reptile (shell by sector top, discs, posts,
  log, stall, meter, palms, tortoise; no 'wall' PropTop), face-paint open sides (post height).
  **Probes take a real y** (parkFacts, castle/hotel tower marches, gateway sweep, library/reptile
  checks): y=0 probes cleared real tops on the sphere → seed 5 restarts all rejected until fixed.
  Seed 5 acceptance at 95a91d32: restart 0 rejected (coplanar, as main), restart 1 accepted (= main).
  TODO: check:solids, census (garden run: 797 tops, 24 regions, 316 s — see below), hop re-measure.
  Left Infinity: the rail centre band (NavGrid closure; (c)), the roof slide mouth (invisible).
- [ ] (c) guards tall

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
