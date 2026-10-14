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
- [x] check-library rebuilt: models' own boxes, LANDING, facade per corner, plinth sides/back,
      portico + recess marches, base-height plan reads, LIGHT lights-only + DARK, READABLE.
- [x] invariant: lean-aware coverage, plan-derived climbs, side/back walks, measured riser;
      noDrawnPavingUnderASolid asks the plinth+steps body (31b2d8fd).
- [x] `/library?at=` DeepLink kind + check:deep-links case; LampPosts owns LIGHT_DECAY.
- [x] coplanar: door / pediment book / reading-lamp stem outlines dropped (their hulls lay on
      the Artist's faces; the book's rejected seed 5 r0), book rows 5 cm clear of panels.
      Standalone sweep: exterior 0 pairs, room 0 (f33fe483).
- [x] fill 1.05 / key 0.675 so the dark aisles are above ink from the lights alone.
- [ ] parks: CI run 38558411242 dispatched on f33fe483 (parks + every consumer); local
      `build:parks` seed 5 running (4 restart lanes) for screenshots.
- [ ] mutation red runs recorded below; screenshots; delete library-preview.* scratch.
- [ ] DO NOT edit src/, procgen/, test/procgen/ while an acceptance/build:parks run is live:
      its child attempts load whatever is on disk.

## Findings worth keeping
- **Jambs are redundant with the glb's shallow recess**: with either jamb removed the
  recess-back end cap and the front wall's end cap leave 0.19 m (measured, flat frame) —
  nothing passes. OPEN_SHELL=6/7 cannot go red; OPEN_SHELL=8 (recess back) lets a body
  5.19 m into the cella. Kept for a deeper recess in a future glb.
- **Cella side/back walls are behind the plinth's edge walls**, so from the lawn they are
  unreachable; OPEN_EDGE=n is the red-proof for the sides/back, OPEN_SHELL=4/5/8 from the
  portico.
- **A y-0 world read slides across a leaning building**: at (50,-2) the base is ~5.7 m
  below world y 0, tan(lean) 0.234 -> 1.3 m. Every plan read in the check is at the base.
- check:library seed 5 restart 0 (LGP_PARK_RESTART=0, no acceptance): all structural
  clauses green — facade deepest 0.004, plinth back-east corner head-on 0.041 (= the
  0.1(sqrt2-1) residual), recess -0.003, sprinter stops at 2.62 (door front 1.99), steps
  0.000, landing 2940/2940 + 752 controls, 64/64 keep-outs, 0 pockets.
- park-attempt seed 5 r0 (old outlines): new invariant green (in, 0.000 everywhere, lean
  tan 0.234); rejected only by check:coplanar — the pediment-book outline (fixed) and two
  layout-dependent garden seams (path-kerb/stone-walls, boundary-blocks/rail-fence) that
  the loop restarts around.

## Checks run
- `pnpm exec tsc --noEmit -p .` exit 0; `pnpm run typecheck:test` exit 0 (f33fe483).
- check-library.mts / check-deep-links.mts typechecked ad hoc (only the known
  `process.exit` noise from test/node-env.d.ts).
