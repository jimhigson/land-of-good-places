# HANDOFF — reptile-ci (PR #708, branch feat/reptile-house, worktree .claude/worktrees/reptile-ci)

Model: Claude Opus 5.5 (Engineer, dispatched by the Overseer).
Push: `git push origin reptile-ci:feat/reptile-house`. Base: feat/procgen-on-sphere (b699c39d).
`timeout` does not exist on this Mac: use `perl -e 'alarm N; exec @ARGV' cmd`.

## Done
- Rebased onto b699c39d (41 commits, no conflicts; 3-dot stat identical before/after; package.json script set = base + reptile scripts + check:reptile-house in shard-4).
- Coplanar rh-head/rh-mouth: lining clipped to head grown LIP_PROUD=0.05 (art/blend/reptile_house_build.py), re-exported.
- check:flat-primitives (shard 1 red): 19 reptile sites marked `// flat-ok:` with reasons (hall is its own flat space at x 600, y 0).
- Castle hat shop displayed the Snake Hat (HAT_KINDS iteration) — now only hats sold at 'hat' (fitouts.ts).

## Findings
- Seed 5 traces (layout/plan/world) identical base vs branch. Outside the reptile roots, the only scene change is hotel pet beds grown by petBedFit (snakes are the largest sleepers) — intended.
- CI Park 1 red = seed 1 restart-1 SOLVE probe > 1800 s (PROBE_TIMEOUT_MS). Locally the same solve is 727 s base vs 728 s branch (51 internal layout restarts). Base passed only because its parks were reused from run 37041179411. Marginal CI timing, not a branch regression.

## Now (Overseer, new scope)
Place the reptile house as a normal anchor building on every seed 0..15, enlarge park boundary slightly (one constant), /spawn link to its doormat on seed 5, CI green, preview screenshot.

## Placement work (commits 09af53fb..0d27c269)
- anchors.ts 'reptileHouse'; parkManifest entry (footprint 10.5, bounding 12, band 24..90, door reach = DOOR_BAND_OUTER+DOORMAT_STANDOFF, pavedTo = DRAWN_DOOR_ALONG, cameraFacing).
- ReptileHouse: with a plot the exterior stands in anchor:reptileHouse via standInPlot (parkRoot); `doormat` getter is the one owner; standAtDoor uses it in the park.
- World passes placedEntry('reptileHouse') + anchorPlots, ownedBy('reptile house'); BUILT_SOLIDS includes it.
- Park growth: PARK_GROWTH = 1.0416 in core/constants.ts (linear; garden half-size, play radius, manifest bands via PARK_EXTENT_SCALE). PARK_AREA_MULTIPLIER 2.17 was tried first: pinned gate -> solveBoundaryRadii threw on seed 5 restart 4.
- Checks updated: check-reptile-house (park doormat, exterior in plot), check-tap-spacing (exterior zones + entry band in the park), check-deep-links (/reptile-house-door on ReptileHouse.doormat), invariants (rh-mouth as a door front; reptile band in tap clearance).
- Next: seed 5 acceptance locally (running), CI Parks for all 16, /spawn?pos= on the seed-5 doormat from the park file, preview screenshot.

## Fixes found by seed 5's acceptance loop (3282c2dc..9637e3ca)
- gate node was a typed z 54 (copy of ENTRANCE_GATE_Z-6) -> GATE_CORRIDOR_START_Z (park growth exposed it; every restart failed noPathEndsNowhere).
- entrance tap zone overlapped the tail zone in the park -> SHELL+0.6 as on the forecourt.
- doormat reach = REPTILE_LIPS_REACH (10.7, asserted vs mesh at load) + SPUR_PAVED_REACH (hotel's rule).
- footprint 10.5 -> 11.8 to cover the tail base collider (REPTILE_TAIL_BASE_RADIUS 0.6), asserted at load.
- Seed 5 restart 4 accepted locally after these (att54c).
- Debug a restart: `LGP_SEED=5 LGP_PARK_RESTART=n node --no-warnings --import ./scripts/ts-extension-resolver-register.mjs scripts/park-attempt.mts` prints failures' first lines.

## CI rounds (b3b48120, 5d777c52)
- Parks: PROBE_TIMEOUT 1800 s killed slow solves (seeds 1/10/11) -> DEFAULT_SOLVE_BUDGET.decisionZero 256 -> 24 -> 8 (per-feature 16 -> 6). All 16 parks passed at 24.
- Procgen invariant shards 1-3 ran out of their 22m30s watchdog re-solving accepted restarts with 720-900 s plans -> the 8 budget.
- check:ground-claims shard 7: railRaceBars/slide/crossings are dep-siblings; list now tiers them (proved green + red).
- railRaceRoadBounded fixture: seed 12 restart 3 -> 2.
- Avoid pushing while CI's Parks runs: a push cancels it (~45 min per Parks round).

## Round a119e0ee (run 37172614020) — where it stands
- Fixed and verified locally: lamps alternate per route (scatterDecoupling seed 12 coupling, 44.2 m wall); test pins moved to seed 1 restart 3 (railRaceRoadBounded 4.6 s; railRaceRefusals + scatter control). Local: 18/18 in those files.
- Previous round (77b920c3, run 37168588131): all 16 parks, every Checks shard, coplanar, swept bus, entrance road, walk reach, every-seed-builds GREEN; only the 3 invariant shards red (now fixed).
- OPEN: Park 14 hit parks.yml timeout-minutes 60 (shown as cancelled). Seed 14 restarts 0-19 all rejected, 11 of them inside the solve ("build": decision-zero budget 8 spent; redraws driven by pathGraph 'paving under a building/railway fence' at scattered spots, cruiser 'loops miss the castle'/'no start poses', train). Last round it accepted at restart 26 inside 60 min; this runner was ~2x slower. Needs a call: generator work on seed 14's acceptance rate, or the Parks time budget.
- No preview yet: PR preview/deploy are gated on Parks.

## Generator work on restart counts (61e94c9d, b6ff26a2)
Scratch worktree .claude/worktrees/reptile-exp (detached, NOT for pushing): env toggles LGP_X_DZ, LGP_X_DZF, LGP_X_GROWTH, LGP_X_NORH, LGP_X_BANDMAX, LGP_X_FAR + XRUN/XHIT instrumentation on path refusals. Runner: /private/tmp/claude-501/lgp-reptile/exp/one.sh <variant> <seed> <restart>. NB the toggles do NOT reach park-attempt.mts's measures (base-like run gave the current park) — only trust park-file-probe solve results from it.
- Layout draws per solve are as heavy-tailed on #706's base (2-35) as here; the difference was budget 256 vs 8.
- Fixed: paving-in-rail-fence refusals now unwind to the train (was the #1 decision-zero cause, base too). Seed 0/14/15 r0-5 at budget 8: 15/18 solves succeed (was ~half); median draws 12 -> 6.
- Fixed: router's distanceToBuiltSolids now includes the Reptile House; its doormat leaves BUILT_SOLID_MARGIN (moved to core/constants).
- Restart counts (CI): before (37168588131) 5,3,10,4,6,1,9,14,18,6,5,4,2,2,26*,3; after 61e94c9d 5,3,10,4,6,1,5,1,3,6,5,4,2,2,>20,7; after b6ff26a2 5,15,10,4,6,1,5,1,3,6,0,4,2,2,running,13. Base (#706): 1,4,2,0,3,0,1,4,0,11,0,1,2,0,0,0.
- Remaining seed-14 causes: Sky Cruiser misses the castle (layout's, ~30% of redraws, same share on base); spurs grazing their own booth/hotel (pre-existing doormat-at-zero-margin pattern, hotel TOWER_DOORMAT_REACH and booth stand points); measures: rail-racer stall vs its own exit 80+ m apart by paving (detour), lawn notch at the gate approach start (0, 56.58).

## CPU-to-accept round (a23f5b8e..33eb4b0f)
- Budget trade-off measured (seeds 0,1,2,14,15 x 8/16/32, whole accept loop, main-thread CPU): worst 5429 / 4102 / 4817 s -> decisionZero 16, per-feature 12; table beside the constant in procgen/boot/parkSolve.ts.
- Cruiser castle misses: ~1/3 of layouts on base and branch alike; no layout predictor (edge distance, neighbours); Reptile House never near the castle. Left alone.
- Hotel doormat now leaves BUILT_SOLID_MARGIN. Booth stand points left (gameplay distance; hits are corner-cutting, not margin).
- Top measure rejection (60/172): "disproportionate paved detour" between a ride and its own booth/exit. arrivalLead now gives plotless booths (ferris kiosk) a head-on lead: connector drawn in 2 of 3 measured cases.
- CI 33eb4b0f (run 37198917576): 13 seeds 12-51 min; 2, 14, 15 cancelled at the 60-min cap (reached restarts 8, 8, 11).
- Local CPU to accept at 33eb4b0f: 0: 1059 s (r5), 1: 2252 (r11), 2: 2819 (r10), 15: 2464 (r12); 14 still running.
- Scratch: .claude/worktrees/reptile-exp (detached; LGP_X_DZ/LGP_X_DZF toggles in earlier revisions). Remove when done.

## Four-arm acceptance (2c802e63, 52aa270d)
Real park-attempt, seeds 0-15 x restarts 0-3, 64 per arm; share of built parks accepted:
base 30%, head@f24a550e 16%, growth reverted 27%, house unplaced 16%, bands not grown 33%, head@52aa270d 27%.
- Cause: PARK_GROWTH scaled the manifest bands while near-relations (metres) and the fountain ring stayed put. Bands now use PARK_SURFACE_SCALE; growth only grows rim + gate (52aa270d).
- Sky Cruiser flew through the house: added to tallObstacles (2c802e63); no rh-* hits in the re-run.
- Authored distances checked: STATION_SEED_RADIUS 60 (used only via route.distanceNear on a bearing - insensitive, left); train lengths are rim-perimeter fractions (derived); RING_RADIUS from fountain (physical); STREET_PITCH 12, turn radii, model sizes physical (fixed); GATE_CORRIDOR_DEPTH relative to the gate (derived).
- Arm worktrees: .claude/worktrees/arm-{head,nogrow,unplaced,base,nobands} on local scratch/arm-* branches (not pushed); remove when done. Results: /private/tmp/claude-501/lgp-reptile/arms/.
