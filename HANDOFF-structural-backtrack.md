# HANDOFF — structural backtracking (feat/structural-backtrack)

Model: Claude Opus 5.5 (1M). Engineer/Architect, Overseer-dispatched. A replacement runs the same model.
Base: origin/feat/procgen-on-sphere (Jim: this branch is the dependency; feat/prebuilt-parks (#705) waits on it).
Worktree: .claude/worktrees/structural-backtrack. Scratch: $SCRATCH/sb/ (session scratchpad).

## Requirement (Jim, verbatim)
"there should be no 'fail some placement checks' GUARANTEED STRUCTURALLY because ALL FEATURES SHOULD BE
BACKTRACKABLE — this means that even in the case of total failure, backtracking to zero will work,
effectively starting again." Plus: every seed must build, not only 0..15; prove on 0..15 + ~100 random.

## Design so far
- `src/world/parkRestart.ts`: PARK_RESTART (LGP_PARK_RESTART env / globalThis.__LGP_PARK_RESTART__),
  `generationSeed(seed, r)` (r=0 -> seed unchanged). parkManifest: PARK_SEED_ASKED = identity,
  PARK_SEED = generationSeed(asked, restart) — every generator already reads PARK_SEED, so restart r is a
  whole new park (boundary included) under the same identity.
- `scripts/lib/parkFindings.mts`: check:park's measures as `measureParkFindings(park, ratchetEnforced)`;
  check-park.mts is now a printer.
- Next: `scripts/park-attempt.mts` (one process: build at (seed, r), run every invariant + check:park,
  print JSON verdict) and `scripts/lib/acceptedPark.mts` (root loop r=0.. until accepted, log restarts).

## Overseer baseline (vet:seeds 0..15 at ae8257fb)
check:park passes all; invariants pass only seeds 2, 5. Instrument/geometry bugs to fix at cause (not
search around): sleepers (#702 fix/sleepers-on-drawn-rails), RR camera (fix/pocket-race diagnosis),
coping chamfer (#698 fix/procgen-last has the fix).
- Sleepers: merged fix/sb-sleepers into wip/sb-merge (#702 port + stationsEvenlyAlongDrawn spacing fix; seeds
  1,3,8,9 sleepers cleared). OPEN: check:coplanar gains race-ring vs walk-past-ring sleeper side faces (canonical
  ~(-53,-9.6,75.4)); rings are mutually exclusive (RailRace.setActiveRing) — decide: teach the check exclusivity.
- Restart-0 identity: seed 11 park digest f949720aa35c7716 identical at ae8257fb and dec4376c (restart stream).
- Sweep 0..15 (base code): 2@r0, 5@r0, 0@r1, 3@r6, 6@r10, 4@r16, 8@r2 ... (log accept-0-15-r1.log).
- Helper running: fix/sb-cruiser-castle (castleSpan null though satisfies=crossesTheCastle).
- Camera: merged fix/sb-race-camera (CEILING_FLOOR 0.6 in measureZoomCeiling; canonical zooms in ≤8.8% on 39 m
  of lap — VISIBLE, needs Jim's look at /rail-race). Seeds 0,1,3,8,9 camera cleared.
- Coplanar: rings declared userData.shownAlone; sweep skips cross-member pairs; ring sleeper baseline entry
  deleted (not loosened). Remaining red: pre-existing seed-24 garden path-kerb|path-surface -> helper fix/sb-kerb.
- Restart-1 control: seed 11 r1 digest aaed3dd7ff9dbc46 ≠ r0 f949720aa35c7716; two processes agree.
- Cruiser-castle: merged fix/sb-cruiser-castle (cruiserRouteSearch throws when tiers end unsatisfied; builder
  refuses a built route with null castleSpan).
- Kerb helper (fix/sb-kerb): seed-24 + canonical kerb|surface fixed (KERB_PROUD_MAX, KERB_HIDE_MAX); seed 131
  residual is a hanging paving SHEET -> same helper now merging/finishing fix/paving-drape. Not yet merged.
- Lattice helper (fix/sb-lattice): moving lattice/grid-axis measures into src + refusals in addInterconnects.
- Duck-bar helper (fix/sb-duck-bars) still running.
- Duck bars: merged fix/sb-duck-bars (refusedBarSlots in simulate.ts; DFS placement in planHazards;
  DuckBarRefusal -> restart). VISIBLE: canonical lanes 1,2 bars move (492.13->564.15, 564.15->420.11).
- Sweep r2 (intermediate, wip/sb-merge after sleepers/camera/castle/duck/coping): $SCRATCH/sb/accept-0-15-r2.*
- Merged fix/sb-kerb (+ fix/paving-drape): check:coplanar exit 0 per helper; seed 11 bushes pass at r0.
- Sweep r2 is MIXED-SOURCE (merges landed mid-sweep into the same tree) — intermediate only. Final sweeps must run
  in a frozen worktree at a fixed commit. r2 so far: 15/16 accepted, mostly r0-r6; remaining causes: lattice (18),
  grid axes (10), rainbow legs near paths (5), anchor.reach:waterFight (4) -> helper fix/sb-reach.
- Merged fix/sb-lattice (d27593b0): src/world/pavingLegibility.ts is the one owner of longDiagonals /
  offLatticeStreetRuns (+ gridAxes.ts moved to src); addInterconnects screens connectors; pathGraph builder
  refuses illegible mandatory paving (consumed train,layout). Conflict resolved: paving-drape's bridge-stone
  line blocker ported into the shared measure as PavingGround.nearBridgeStone (built: footprintNear; planned:
  walk footprint -> stricter). NEXT: frozen-worktree sweep of 0..15 at this commit, then 100 random.
- Frozen sweep r3 @025efdb4 (0..15, --fresh): 16/16 accepted, 7 restarted, max 7 attempts, mean 2.00, 718 s.
  Remaining restart causes: lattice (gate-approach/spurs still slip past the plan-time screen — built vs planned
  ground mismatch, INVESTIGATE), sheets (0,1,10), spur centreline, rainbow legs, slide legs/cameras, detour.
- 06223019: src/world/acceptedRestarts.ts (generated by accept:parks --write) = the loop's answer per shipped seed,
  read at import (restartFor); check:park/test:procgen use it (acceptedRestartOf). Seed files for 0..15 + pool;
  check:accepted-restarts (shard 1) proves table == seed files ⊇ 0..15 ∪ pool. Pool acceptance running in
  sb-frozen (--write there; copy values over). 100 random seeds running in sb-random @06223019
  (seeds in $SCRATCH/sb/random-seeds.txt, log accept-random.log).
- Lattice mismatch ROOT CAUSE (seed 5 r0): the pathGraph legibility screen stands on the CONSERVATIVE planned bridge
  footprint (superset of the built one: 29 gate-approach samples covered by plan only, 0 built-only), so it
  exempts/blocks more than the built measure and lets gate-approach (z=60) and spur-building (x=-12.56) through.
  Kept (a no-bridge screen would refuse every crossing ramp); comment corrected. Root loop catches the rest.
- Merged fix/sb-reach (waterFight gun rack placed by door bearing, clamped inside plot; VISIBLE rack move).
- Pool restarts recorded (b033643c): 24:0 128:7 131:0 208:5 274:1 326:0 428:1 451:2 20260728:0.
- procgen-invariants.yml sharded x5 + pool job + aggregator "Procgen invariants" (protection read back unchanged).
- check:coplanar NEW: cat-bus chassis seam on generation seed 860110031 -> helper fix/sb-catbus.
- Random sweep running (sb-random @06223019). After it: full test:procgen + check:every-seed-builds on frozen tree.
- Random 100: 100/100 accepted, max 8 attempts, mean 2.04, p=0.49 (doc section written).
- SCOPE: Jim supports 0..15 only. SUPPORTED_PARK_SEEDS in parkSeedPool.ts (#705 moves it to prebuilt/parkFileName.ts
  and makes PARK_SEED_POOL = it). acceptedRestarts + seed files = 0..15 exactly (151dac7e).
- #705 CI findings -> helpers: fix/sb-fountain (fountain-hop s10), fix/sb-seed5 (castle-towers, cruiser cart 1.11deg),
  fix/sb-coplanar16 (coplanar over 0..15). Each told scope 0..15.
- Running: full test:procgen at 151dac7e in sb-frozen (log procgen-151dac7e.log).
- TODO after helpers: emulate #705 pool=0..15 locally and run pool-sweeping checks (park-pool, gateway,
  fountain-hop, swept-bus, entrance-road, path-preference, stall-accommodate, every-seed-builds).
- VERIFIED @151dac7e/ac9f2490 (frozen sb-frozen): full test:procgen 1840 tests, only fail was scatterDecoupling
  identity (fixed ac9f2490, 4/4 pass); check:every-seed-builds 16/16 built, exit 0 (check:park per seed at recorded
  restart, ratchet enforced).
