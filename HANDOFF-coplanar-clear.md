# HANDOFF — coplanar-clear

Branch `fix/coplanar-clear`, off `origin/feat/procgen-on-sphere` @ e982430b.
Goal: `pnpm run check:coplanar` green, each finding fixed at its cause. Never add/widen a baseline entry.

## Base run (e982430b): exit 1, headline "10 new or worse", 10 detail lines (NEW 6, WORSE 2, MORE 2, TIGHTER 0), 0 BASELINE LOOSE. 81 s.

## Per finding — cause and status
- keychain.rumi MORE 8>7 — head+hair 16-seg blobs, aligned facets. FIXED: hair geometry rotateY(pi/16). 9 pairs -> 0 (default seed).
- fountain|path-surface NEW (seed 428) — wishing coins buried inside basin floor slab (never visible). FIXED: coins deleted.
- stall:dodgems/railRacer Box|Cylinder WORSE — scallop end caps 9 mm inside cloth end face. FIXED: caps notched (hidden band cut). Affects all stalls -> expect ~7 BASELINE LOOSE.
- hotel entrance-door-left/right|terrain NEW (seed 11) — outline hull underside 22 mm below leaf foot. FIXED: dropOutlineFoot in slidingDoors (also lift doors).
- entrance-gateway-path|entrance-road-kerb NEW — 5 mm step (road 0.06 vs path 0.055) at shared edge. FIXED: edge row takes road chord height.
- stone-walls Box|Box NEW — wall and coping each standOnSphere'd about own pivots -> coping slides ~9 cm sideways, long face 8 mm from wall face. TODO (fix = one rigid group; recentres coping: tiny visible change, ask Overseer).
- path-kerb|path-surface NEW — one route's kerb band under another route's surface at junctions (on bridges / convex ground chord sag eats the 2.5 cm). TODO: hard.
- railRace walk-past-ring Box|duck-bars MORE 4>1 — HELD BACK (alert sleeve vs bar; ruling needed). MORE is per-instance lean on the sphere.
- trestle-branches: not present in base run.

Probe scripts (untracked, do not commit): scripts/_probe.mts, _probe2.mts, _door.mts, _stall.mts

## Update 2 (after kerb + baseline commits)
- path-kerb: FIXED by dropping kerb triangles wholly under other routes' paving (exact convex difference). Partial cutting was tried and REVEALED kerb|terrain (0.755 m2 @2mm seed 11) and kerb|bridge shell (seed 128) — metric is per triangle pair, furthest vertex; smaller triangles reveal. Whole-triangle-only cannot reveal.
- Baseline: 8 LOOSE entries deleted (6 stalls, 2 keychain).
- stone walls: fix on side branch `fix/coplanar-clear-stone-walls` (placeOnSphere for wall+coping). HELD: visible recentre ~9 cm.
- Remaining on PR branch, run4: headline 3 = MORE duck-bars (held), NEW stone-walls (held), NEW path-kerb|path-surface 0.0001 m2 @8.1mm seed 131.
- Seed 131 kerb|surface cause: a route along z at x~0 passes through bridge-56's footprint (bridge long in x); the drape lifts it onto the deck: pavingHeightAt 0.4-1.0 vs terrain -3.6..-4.0 at x=0,z=38.5..42 -> 4.4 m curtains of paving. Out of scope (bridge drape), report.
- Verification in progress: test:procgen base (worktree coplanar-clear-base @ e982430b) -> then branch; swept-bus; park digest; check.
