# HANDOFF — Architect, Decision 2.1 (Park Replan)

**Status:** starting fresh (prior run cut off before any work landed on disk).
**Task:** Decision 2.1 — park replan: interesting train route with tunnels under
paths, track exclusion (visible+invisible walls), bridges over track, first-person
train ride with look-around, two-track first-person coaster on real rails. Deliver
as a new decision section appended to ARCHITECTURE-DECISIONS.md, on a branch, with
a PR. Include ASCII map. Supersedes Decision 1's concentric-band premise — must
state what survives.

## Checkpoints
- [x] Read ARCHITECTURE-DECISIONS.md (Decisions 1 & 2 + family answers: coaster is
      TWO-TRACK side-by-side, first-person only, curtain-blink entry)
- [x] Read ORDER-OF-WORK.md Wave 4, GAME_DESIGN.md (replan brief, spooky house,
      station paths, FP train, control rule)
- [x] Read route.ts, track.ts, station.ts, ParkTrain (station seeds via
      distanceNear(±60,0)), terrain.ts, WalkSurfaces, AnchorPlots, anchors,
      paths.ts, poiGraph, Garden, Collision API, entrance/layout (GATE AT SOUTH
      (0,60), bus stop (0,52)), ferrisWheel/look.ts
- [x] Worktree .claude/worktrees/architect-park-replan, branch decision/park-replan
      off current origin/main (4876f69)
- [x] Wrote decision into ARCHITECTURE-DECISIONS.md on the branch (committed
      in two parts, then rebuilt on moved main)
- [x] main moved mid-task: castle-floors ruling landed as Decision 3 (#45) +
      CLAUDE.md added. Renumbered mine to **Decision 4**, spliced above theirs,
      reconciled WalkPatch note with their WalkSurfaces rewrite (compatible;
      T2-before-S2 sequencing rule added). Branch reset onto origin/main at
      50254e4; old base kept at backup/park-replan.
- [ ] Push + PR (in progress — if pulled, push decision/park-replan from
      .claude/worktrees/architect-park-replan and open PR titled
      "Decision 4: the park replan"; doc-only change, no build impact)

## THE DESIGN (settled; write-up in progress)
- Rails NEVER leave terrainHeight (+RAIL_HEIGHT). Verticality is BUILT UP, never
  dug: tunnels = mound shells over grade-level track; bridges = walkable decks.
  Heightfield/terrain.ts untouched.
- New route: radius-per-bearing SOLVED as today, but pull target becomes an
  AUTHORED per-bearing profile: dips to r~29 at the four cardinal corridors
  (N/E/S/W gaps between plots), bulges r~53-57 behind the four plots. Solver
  legality machinery (lo/hi, repair, nudgeOffScenery) survives; add explicit
  RING_KEEP_OUT=28.5 lower bound, obstacle side-choice (plots beyond target
  are upper bounds: spooky island, entrance forecourt), curvature assert.
- Attractions: building/castle, ball pit, ferris, dodgems, water fight, plaza
  ALL STAY. Spooky house becomes 6th anchor at (-4,-46) north edge (an island
  beyond the rails, reached by a bridge). Coaster station anchor (10,-5) per D1.
- 4 structures: S entrance tunnel-mound (esplanade from cat-bus/gate crosses over),
  N spooky bridge, NE decorative hill tunnel behind ferris, E picnic-island bridge
  near Sunny Side. W outer pocket = Statue Garden (view-only, item 4.7 statues).
- Stations move inward with the dips automatically (distanceNear(±60,0) kept);
  platforms end up beside the ring road -> trivial spurs, poiGraph seeds added,
  off-graph steering retired.
- WalkSurfaces gains addPatch({heightAt(x,z)->number|null}) for bridge decks/
  esplanade; paths.ts gains per-route elevation override; crossings computed at
  boot by intersecting paths with solved curve; structures parametric.
- Exclusion: solved-curve offset walls both sides (2.5 m, non-hoppable), gaps at
  platforms suppressed (invisible wall at platform face), visible dressing only
  where reachable; Scenery gains "railway reserve" no-plant strip from target
  profile (+ coaster pylon corridor).
- RideCamera: extract ferris look-around (look.ts + gondola cam math) into
  src/core/RideCamera.ts + core/rideLook.ts, ferris adopts FIRST with pixel
  parity (its directions are confirmed correct), then train FP, then coaster.
  Game.cameraOverride per D1 PR-1.
- Coaster: D1 route survives elevated two-track (2.2 m gauge); re-validated vs
  new train curve at boot (>=5.5 m rail-over-rail, pylons >=2.5 m off track).
- Sequence R1..R9 (route first; camera chain RideCamera->train FP->coaster ride
  strictly serial; placements only after R1).

## Key facts so far
- Decision 1 put train in outer band r48-58 (solved route), coaster elevated
  r15-45 (authored). The replan supersedes the band premise.
- Family answers (bottom of ARCHITECTURE-DECISIONS.md): coaster = two parallel
  rails ~2.2 m gauge, whole circuit side-by-side; first person only.
- Decision 2 (queues) depends on station positions — keep station/queue contract
  compatible (RideQueue feeds claimSeat).
- main is at 4876f69; train may only exist on feat/park-train branch or the
  integration worktree .claude/worktrees/agent-aff75b8bf22683c43 — verify.
- Repo has other agents' uncommitted changes on main checkout (IsoCamera.ts,
  style.css, screenBasis.ts) — do NOT touch; work via a separate worktree.
