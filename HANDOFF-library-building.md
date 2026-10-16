# HANDOFF — Library building (#716, part 2 of epic #714)

Branch `feat/library-building-716`, worktree `.claude/worktrees/library-building`.
Engineer (Opus 5.5), second engineer on this branch (14 Oct). Headless
playwright only — the shared Chrome MCP is not this task's.

Jim's 13 Oct ruling: ONE PR for the whole Library feature; the workflow raises
it. Do not raise a part-PR from here.

## Scope (from the Overseer's brief)
1. `library` plot (parkManifest + anchors), solver-placed, camera-facing, every seed.
2. Pillared exterior on the plot — **now `library.glb`** (art/library-715, merged 30472958).
3. Interior: its own disjoint space at (-600, -600), 36 x 26 m, open-topped,
   shelves, desk, reading nook, instanced books, dim warm lighting.
4. Door portal both ways (SpaceManager), save/restore via spaces.ts.
5. `/library`, `/library-door` deep links.
6. `check:library` in the check chain; procgen invariant for the plot.

## Decisions (with reasons)
- **Origin (-600, -600)**: past FOG_FAR from every other space (see constants.ts).
- **Footprint is a circle** (plinth corner radius): a camera-facing door turns the
  building 45 degrees and plots are axis-aligned.
- **No typed contract number anywhere.** `src/art/models/libraryKit.ts` parses the glb
  once and measures the exterior plan off the bare vertices (plinth, step treads,
  cella extents incl. the window sills, the doorway by ray, columns clustered from
  the one `shell-columns` node, reach) and the shelf footprint. `layout.ts` derives
  the plot radius, bounding radius, steps front and interior doorway width from it;
  `paths.ts` keeps paths off the measured plinth. The kit is in the park closure, so
  an Artist change re-solves the parks by itself.
- **Steps are walk surfaces, not colliders** (a 0.18 riser with topIsAbsolute is a wall
  to feet on the floor). The bottom step's plate runs on under the plinth's by
  `(plinthTop - stepTop) * tan(lean) + 0.05` so no lean leaves an uncovered sliver.
- **The plinth's sides and back are thin plain walls on the drawn edge** (not
  topIsAbsolute: on a building leaning up to ~22 degrees a single world-y top cannot
  be right along an edge). The full-width steps are the one way up. Fixes the
  "walks into the plinth slab from the portico side" blocker by construction, no
  extra restarts.
- **Cella ring = measured extents** (sills included, so 18 cm of air in front of the
  facade between the windows — conservative, never undersized), its six outside
  corners squared by thin capsules (residual 0.04 m, was 0.124).
- **Skirt**: the glb plinth has no skirt, so `createLibrarySkirt(depth)` carries the
  stone 2 cm inside the plinth's faces down to the lowest ground round the plinth
  + 0.3 (measured per placement, `librarySkirtDepth`).
- **Stacks are two kit shelves back to back** (1.2 m deep, books both faces); low bins
  stay this file's own primitive, length/depth from the measured shelf. Side table,
  rug, sconce: own primitives (not in #715's kit). Story chair = the kit armchair in
  tapestry cloth. Secret case drawn from `secretShelf` (hinge origin) with its books
  on the door so #719 only has to rotate it.
- **Turned plates**: `OrientedPlate` — a 45-degree chair's walkable top is its drawn
  footprint (not a 10 cm strip, not a square of air).
- **Readable slots on shelves 0/1 only**, asserted at build against KID_REACH_HEIGHT
  (`assertReadableSlotsInReach`).
- **Name: a NameLabel pill "The Library"** over the entablature (screen-constant, TEXT
  RULE-proof; the 28 July ruling keeps words off in-world boards). Jim's 13 Oct
  "the sign reads The Library" vs a painted board is a question for Jim.

## State
- [x] glb merged (30472958); kit + measured plan; assets dressed from STYLES (all 65 nodes).
- [x] layout/paths/manifest read the measured plan; colliders/plates rebuilt (5f6f1b77).
- [x] check-library rebuilt (models' own boxes, LANDING, facade per corner, plinth sides/back,
      portico + recess marches, base-height plan reads, LIGHT, READABLE) — green on seed 5
      restart 1 (the accepted park at f33fe483's hash), every mutation proved red (below).
- [x] invariant: lean-aware coverage, plan-derived climbs, side/back walks, measured riser;
      noDrawnPavingUnderASolid asks the plinth+steps body (red-proved below).
- [x] `/library?at=` DeepLink kind + check:deep-links case; LampPosts owns LIGHT_DECAY.
- [x] coplanar: door / pediment book / reading-lamp stem outlines dropped, book rows 5 cm
      clear of panels — standalone sweep exterior 0, room 0.
- [x] look, judged on real-game headless frames (seed 5): dim room under the nap night sky,
      5.5 m pools, lilac fill 0.4, key 0.25, room lift 0.04, glowing doormat at the way out,
      warm-wood bin backs (0cc342b8).
- [x] CI run 38558411242 on f33fe483: all 16 parks accepted (restarts 0:3 1:1 2:3 3:7 4:1
      5:1 6:1 7:5 8:1 9:5 10:9 11:4 12:0 13:6 14:8 15:4); green: Checks shards 2-6/8 (shard
      4 = check:library on the accepted park), Coplanar faces (interiors incl.), Procgen
      shards 1-4/6, Walk reach, Every seed builds, Swept bus, Entrance road. Red, fixed at
      cause: shard 1 (check:flat-primitives — four object-local expressions marked flat-ok;
      check:brevity — the sign subtitle was two sentences), shard 7 (check:layout-rung's
      ring fixture now allows a real plot inside the ring: seed 5's ball pit), procgen shard 5
      (railRaceRefusals' pin re-picked: seed 3 restart 7, 35.1 s plan on CI).
- [x] local after the fixes (seed-5 park, .parks pointed at the current hash): shard 1 green,
      shard 7 green, check:brevity, check:layout-rung, railRaceRefusals (16.5 s) green.
- [ ] CI run 38569170320 dispatched on d10fd02d (the final closure): result pending at the
      time of writing — read it before raising the PR.
- [x] library-preview.* deleted: it no longer loads (parkManifest's deterministic-math guard,
      no client solver) and bypasses the real lighting/terrain, so its frames are no evidence.
- [ ] DO NOT edit src/, procgen/, test/procgen/ while an acceptance/build:parks run is live:
      its child attempts load whatever is on disk.

## Red runs (each with the geometry it was proved against)
All on seed 5 restart 0 unless said (`LGP_SEED=5 LGP_PARK_RESTART=0`, no acceptance), library
at (50.1, -2.3), lean tan 0.234, base set -0.236 m, plan: plinth +-9 x [-7, 7], cella +-8.38 x
[-6.4, 2.78], door half 1.6, door leaves' front 1.987, columns +-2.25/+-4.95/+-7.65 at z 4.85 r 0.78.
- `LIBRARY_CHECK_OPEN_SHELL=8` (recess back wall): facade 5.198 m into the cella; portico/
  recess marches 5.195 m (straight at the door); sprinter stops at -4.98 (door front 1.99).
- `LIBRARY_CHECK_OPEN_SHELL=4` (front wall west of the door): portico marches 2.532 m into
  the masonry (the doorway's west corner).
- `LIBRARY_CHECK_OPEN_EDGE=1` (plinth's east edge): square marches 3.108 m over its stone
  (east side, 3.8 along).
- `LIBRARY_CHECK_DARK=1` (fill and key to 1e-4): darkest floor 0.0000 from the lights
  (run against the pre-0cc342b8 lights-only clause; the lift-counting clause is red too:
  lift 0.016 < ink 0.0509, so lights + lift < ink with no fill and key).
- Landing (props.ts reverted to the two-corner plate, not committed): 252 of 2940 landings
  fell through (nook-armchair, east-armchair at 45 degrees) and 4 controls found a top in
  the air.
- Paving (scratch script: a 1.2 m paving square drawn on the plinth's back-west corner,
  local (-8.5..-7.3, -6.5..-5.3)): control [] as built; mutated: "1.37 m² of drawn paving
  near 40.5, -1.6 lies under a library — 1.62 m inside the Library's plinth and steps".
- OPEN_SHELL=6/7 (jambs) cannot go red, by measurement: see Findings.

## Findings worth keeping
- **Jambs are redundant with the glb's shallow recess**: with either jamb removed the
  recess-back end cap and the front wall's end cap leave 0.19 m (measured, flat frame) —
  nothing passes. OPEN_SHELL=8 (recess back) lets a body 5.19 m into the cella. Kept for a
  deeper recess in a future glb.
- **Cella side/back walls are behind the plinth's edge walls**, unreachable from the lawn;
  OPEN_EDGE=n is the red-proof there, OPEN_SHELL=4/5/8 from the portico.
- **A y-0 world read slides across a leaning building** (1.3 m at tan 0.234, 5.7 m below
  y 0): every plan read in the check is at the base.
- **The interior lift lights a room by itself**: 0.16 of the colour (parts.ts) renders a
  floor at 0.064 luminance with no lamps — above ink. The library uses 0.04 so its lights
  decide; the toon ramp makes direct light >= the cosine model, so the check's Lambert
  model is conservative.
- **Pools of 11 m overlap into one flat wash**; 5.5 m reads as pools (6.9x contrast).
- park-attempt seed 5 r0 (f33fe483 minus outline fixes): invariant green; rejected by
  check:coplanar (book outline, fixed) + two layout seams the loop restarts around.
  build:parks seed 5 at 55ce5f5b (= f33fe483): accepted restart 1, 2 attempts, 526 s.

## Checks run
- `pnpm exec tsc --noEmit -p .` exit 0; `pnpm run typecheck:test` exit 0.
- check:library seed 5 restart 1 (`LGP_PARK_RESTART=1`, at 0cc342b8): **All clauses passed**,
  exit 0 — 64/64 keep-outs, 0 pockets, boxes 0.041, landing 2940/2940 + 752 controls,
  facade -0.000, plinth corner 0.040, portico -0.012, sprinter 2.64, steps 0.000, LIGHT
  0.0580 vs ink 0.0509 (lift 0.016), pools 6.9x.
- Screenshots (headless Chromium, seed 5, served from the seed-5 park accepted at
  f33fe483's hash; later commits changed only the room's look and the nap-sky line):
  scratchpad/building/final-*.png and v2/v3-*.png.

## Dev server, and a trap worth knowing
- vite on 5671 (`--strictPort`) for screenshots; stopped by PID when done.
- **Editing anything in the park closure while a dev server or a Node check is running
  against `.parks/` starts acceptance loops**: the dev middleware and the restart resolver
  both key on the source hash, so a stale `.parks/manifest.json` sends every page and
  every check into `build:parks`/`accept-parks`. Look-only iteration was done by pointing
  the manifest at the new hash (layout unchanged); the manifest is restored to the hash it
  was accepted at (55ce5f5b) now.
- Screenshots in the scratchpad `building/`: final-exterior-from-park, final-exterior-side,
  final-door-from-doormat, final-interior-{arrival,stacks,story-rug,nook,desk,
  door-from-inside} — seed 5, the park accepted at f33fe483's hash (restart 1), code at
  d10fd02d's look.
