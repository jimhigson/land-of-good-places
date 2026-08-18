# HANDOFF — grid-aligned park (issue #269)

Branch: `grid-aligned-park` · Worktree: `.claude/worktrees/grid-aligned-park`

## What issue #269 asked for

1. Stalls and buildings should be placed to directly face the camera —
   axis-aligned facing, not arbitrary rotation.
2. Paths should run perpendicular to grid axes — no diagonal/arbitrary-angle
   paths.

## What's done

- **Facing**: `core/constants.ts` gets one new constant, `CAMERA_FACING_YAW`
  (`CAMERA_YAW_DEGREES` in radians — the isometric camera's own fixed
  diagonal). `parkLayout.ts`'s `signYaw` is now always exactly that value for
  every plot (previously `Math.PI * rng.range(0.2, 0.3)`, a fresh random draw
  every seed). `counterFacing()` is now an identity function (previously
  `signYaw * 0.35`, a second, independently-tuned approximation of "faces the
  camera"). `stallPlacement.ts`'s face-paint stall uses the same constant
  instead of its own hardcoded `0.3`. Every camera-facing thing (the 6 stalls
  + hotel) now turns to exactly the same angle, and every plot's sign
  (camera-facing or not) does too.

- **Paths**: `paths.ts` keeps the original, proven diagonal router
  (`detourAroundBlockers`, renamed from `routeAround`, logic unchanged) as a
  first pass, then axis-aligns its output. `elbowLeg` turns each diagonal leg
  into one right-angle corner (picking whichever of the two keeps both new
  legs clear of every blocker, tie-broken by correcting whichever axis moves
  *less* over that one leg first — see the big comment on that tie-break for
  why the naive "further from the plaza" version regressed). `gridDetour` is
  a small bounded grid search used only when neither raw corner is clear (two
  nearby blockers boxing in the direct line) — it is not the general router,
  learned the hard way (see "Dead ends" below). It widens its own search
  reach (45/90/160 m) on failure, and drops any blocker that already
  contains one of the leg's own endpoints from the whole search (arriving at
  a destination can legitimately sit inside one — see `gridDetour`'s own
  comment). The ring road (`solveRing`/`toAxisAlignedLoop`) and every spur go
  through this. The gate-approach and fountain-approach connectors
  deliberately do **not** — see the comment at their call site: they sit in
  the same ground the cat bus arrival's crowd crosses, and re-shaping them
  measurably (if not sufficently on their own) affected that.

- **Invariants** (`test/procgen/invariants.ts`, both registered in
  `INVARIANTS`):
  - `buildingsFaceTheCameraAxis` — every plot's `signYaw` is exactly
    `CAMERA_FACING_YAW`. Cheap, exact, by-construction now that the RNG draw
    is gone.
  - `pathsRunOnGridAxes` — no paved edge's *drawn* curve (sampled every
    ~0.5 m, not the control points) runs diagonally for more than
    `MAX_DIAGONAL_APPROACH` (16 m) continuously. Not zero: a booth's own
    doorway approach and a train platform's fixed final turn are
    deliberately diagonal (documented in place). Calibrated against the
    canonical seed's measured worst case (11.2 m, the west station's own
    platform approach) with headroom, the same shape of bound
    `TRESTLE_GAP_TOLERANCE` already uses.
  - `ParkFacts.plots` grew a `signYaw` field (`parkFacts.ts`) to support the
    first invariant — read straight off `PARK_LAYOUT`, not re-derived.

- **The cat-bus arrival — a real, in-scope design fix, not a workaround.**
  Grid-aligning the paths shifted plot/entrance positions enough to regress
  `check:cat-bus` (a background child and a scripted bus-arrival child
  passed within 0.72 m of each other — needs 0.99 m). Investigated properly
  rather than patched around; two real, separate findings, both fixed:

  1. **`ArrivalSequence.ts` drove a disembarking child's position directly
     (`NpcCharacter.beginScripted`/`setScriptedPose`) all the way from the
     bus door through the gate and *several metres into the park*** before
     handing them to the normal `WanderDriver` — contradicting
     `BusArrival.ts`'s own doc, which already said `disembark()` should fire
     "the moment a child steps down, not when the whole sequence ends."
     While scripted, a child is exempt from `NpcSystem`'s collision **and**
     separation entirely (needed so the crowd's relaxation doesn't walk
     seated passengers out through the bus's own walls), and follows a
     hand-authored Bézier route with zero awareness of where the free-walking
     crowd actually is.

     Per Jim's explicit design decision (no bespoke arrival choreography
     beyond what a bus door genuinely requires — disembarking children
     should be ordinary NPCs with a pathfinding destination, exactly like
     any other background child): a disembarking child is now released the
     moment their own route crosses `RELEASE_Z` (8 m inside the gate,
     `ArrivalSequence.ts`), not at the end of the old route. The fan-out
     choreography *through* the ~8.8 m gate opening is unchanged — same
     Bézier curve, same tuning to keep eleven children from clipping the
     gate posts or each other — only the *tail* of the walk (the part that
     actually crosses the free-roaming crowd's paths) is cut in favour of
     `WanderDriver.rejoinGraph('full')`, the exact mechanism every other
     child uses. This also fixed a second failure ("1 of 11 bus children
     vanished") as a side effect — same underlying issue, its own threshold.

  2. **The residual gap** (still present after (1), but much smaller):
     `NpcSystem`'s child-vs-child separation (`NpcCharacter.separateFrom`) is
     deliberately soft and rate-limited (`MAX_DEPENETRATION_SPEED`) — real,
     working, *intentional* for ordinary free-vs-free crowd behaviour
     (children brushing past each other in a queue is desired, not a bug).
     But a scripted-vs-free encounter only ever has **one** mover (the
     scripted child cannot be pushed), and it was getting the same
     rate-limited correction as an ordinary two-sided encounter, which
     splits the job between two movers. `NpcCharacter.ts`'s
     `SCRIPTED_ENCOUNTER_SPEED_FACTOR` (2.4×) lets that one mover correct
     faster, since it is doing the whole job alone. (Widening the *trigger
     radius* instead was tried first and measured **worse** — 0.50 m,
     because earlier warning didn't help when the free child's own wander
     target kept steering it back onto the same crossing. Reverted; the
     rate, not the range, was the actual gap.)

  Verified: `check:cat-bus` passes on the canonical seed (1.64 m closest
  approach — matching `origin/main`'s own margin exactly) and the collision
  metric is independently clean on seed 2 too (1.23 m; that seed's only
  remaining `check:cat-bus` failure — the bus stopping inside the boundary —
  is a pre-existing, unrelated bug confirmed present on a clean `origin/main`
  checkout with `LGP_SEED=2`, nothing to do with this change). `check:jitter`
  still passes (worst own step 0.185 m, bound 1 m). `check:crowd` and
  `check:npc-perch` unaffected.

## Verified green

- `npx tsc --noEmit` — clean.
- `npm run check:park` — 16/16 attractions routed, 0 rail crossings, 189/189
  waypoints connected, all six invariants hold (canonical seed).
- `npm run check:solve-cost` — `paths` stage 86.1 ms against a 250 ms budget
  (was 12 ms on `main` before this PR; was 1.4–1.7 **seconds** in an earlier,
  abandoned draft of the router — see "Dead ends"). The ring-widening entry
  search added for the seed-2/18 fix (below) does not show up here: it only
  ever engages for the handful of legs that were already failing outright.
- `npm run check:cat-bus`, `npm run check:jitter`, `npm run check:crowd` —
  all green (canonical seed).
- **`npm run test:procgen`, run fresh in one sitting after the seed-2/18 fix
  (commit `09827ee`): 13 test files passed, 361/361 tests passed, exit code
  0.** This is the number to trust — see "The real CI failure and its fix"
  below for why an earlier claim of "all five seeds green" in this same repo
  turned out to be wrong, and what changed since.

## The real CI failure and its fix (read this if seed 2 or 18 look wrong again)

The PR was first opened claiming "all five seeds green, 62/62 each," but that
claim was assembled from vitest runs taken at *different* commits — seed-2,
seed-5, seed-18 and canonical were never actually re-run after the final
commit that restricted the arch-foot exemption. GitHub's real CI caught it:
`pathsRunOnGridAxes` genuinely failed on seed 2 and seed 18, both on
`spur-stall.railRacer` (25.4 m and 28.7 m diagonal runs — the raw,
un-axis-aligned distance, meaning the router had given up entirely on that
leg). Reproduced locally with the exact same numbers CI reported, which ruled
out a stale/pinned-seed false pass (CLAUDE.md's "static import loads
`parkManifest.ts` before the seed is set" class of bug) — `isolate: true` in
`vitest.config.ts` was doing its job; this was a real, deterministic bug.

Root cause, found with targeted debug logging (since stripped —
`LGP_DEBUG_ELBOW`/`LGP_DEBUG_SCB`, if you need to reproduce the technique):
`gridDetourAttempt` only ever tried the 4 grid corners immediately *touching*
each endpoint as A* entry/exit candidates. For the rail-race stall's doormat
on these two seeds, all 4 were blocked — two by the stall's own plot at a
genuine mid-segment closest approach (correctly not exempted; the exemption
only applies to a connector arriving "practically at" its own endpoint, and
these weren't), two by neighbouring arch feet (never exempted, per the
seed-11 fix). With zero viable entry points at *any* search reach, the whole
search gave up and returned the raw diagonal `detourAroundBlockers` had
originally found.

The gaps were small (0.15–0.6 m short of clearing). Fix: when the immediate
touching corners are all blocked, `gridDetourAttempt` now widens outward ring
by ring (2 m grid steps, Chebyshev shells, capped at 4 rings) and takes the
first ring with any walkable candidate, instead of giving up. See
`entryCandidates` in `paths.ts`.

Verified fresh after this fix (commit `09827ee`):
- `npx vitest run test/procgen/seed-2.test.ts test/procgen/seed-18.test.ts` —
  2 files passed, 124/124 tests passed.
- `npm run test:procgen` (all 5 seeds, one sitting) — 13 files passed,
  361/361 tests passed.
- `npm run check:park` and `npm run check:solve-cost` re-run afterward, still
  green (numbers above).

**If you're re-verifying this yourself: do not trust a per-seed count
assembled across separate historical runs. Run `npm run test:procgen` once,
fresh, and quote the number that's actually on the screen.**

## Dead ends (so nobody re-walks them)

- **A grid-quantized A\* as the *general* router.** First attempt: snap every
  point to a coarse grid, A\* between grid nodes, screen the endpoints
  against their own blocker circle. Two failures: (1) rounding a continuous
  point to its *single* nearest grid node can land that node inside the very
  blocker the point was deliberately placed just outside of — nearly half of
  all routes came back "unreachable" and silently fell back to a straight
  diagonal, defeating the point; (2) even after fixing that (multi-source,
  screening all 4 touching corners), running a full grid search on *every*
  leg — including the ring's 32 short inter-bearing hops — regressed
  `check:solve-cost`'s `paths` stage from 12 ms to 1.4–1.7 **seconds**.
  `gridDetour` is what's left of this idea: the same multi-source technique,
  but only invoked as a rare fallback, never the general case.
- **Corner tie-break by "further from the plaza."** Reads plausible and is
  *wrong*: it chains. `detourAroundBlockers` had already bulged one diagonal
  a little north to clear a single obstacle; four short legs in a row each
  independently chose the more-northward of their own two corners, and an
  8 m bulge became a 40 m dead-flat plateau — long enough to strand a
  waypoint on its far side (`check:park`'s `poi.stranded`). Fixed by making
  the tie-break purely local (correct whichever axis a *single* leg moves
  less on, first) — see `elbowLeg`'s own comment.
- **`bestBranchPoint` scoring candidates on the axis-aligned length.**
  Rewards degenerate cases: a candidate whose `elbowLeg` gives up and falls
  back to a raw diagonal reports the *direct* distance, which reads as
  suspiciously short exactly when it's hiding the worst-shaped route on
  offer. Fixed by scoring on `detourAroundBlockers`'s proven distance
  instead, and axis-aligning only the winner.
- **No boundary awareness.** `elbowLeg`/`gridDetour` only ever checked plot
  blockers, not the park's own spline edge. An axis-aligned corner ran
  parallel to the boundary wall near the gate for long enough to strand
  another waypoint. Added `segmentClearOfBoundary`, against `PLAYER_RADIUS`
  (not the stricter plot `BOUNDARY_CLEARANCE`, since some plots — the
  rail-race stall — stand deliberately close to the rim).
- **One fixed `gridDetour` search reach.** 45 m was enough for seed 5's
  sky-cruiser stall, not enough for seed 18's ball-pit spur. There is no
  single constant that is "enough" for every seed's solved geometry — widen
  on failure instead (45/90/160 m).
- **Treating an embedded destination as unreachable.** Even at reach 160,
  seed 18's ball-pit spur still failed: its own endpoint sat inside the
  castle's blocker radius (a legitimate "arriving at a destination" case
  `detourAroundBlockers` already allowed), and a grid search has no walkable
  cells leading up to a point genuinely inside a blocker unless that
  specific blocker is dropped from the whole search, not just exempted at
  the one corner touching it.
- **`gridDetourAttempt` screening only the 4 grid corners immediately
  touching each endpoint.** Worked for every seed tried at the time, then
  failed for real on seeds 2 and 18 once CI ran it — a stall's doormat can
  sit in a pocket tight enough that all 4 immediate corners are blocked
  (two by its own plot's mid-segment footprint, two by neighbouring arch
  feet), even though a corner one or two grid steps further out is clear.
  Fixed by widening outward ring-by-ring when the immediate ring is empty
  (`entryCandidates`) — see "The real CI failure and its fix" above. This is
  the one to remember: a case that passes on every seed you happened to try
  locally is not the same as a case that's actually handled.
- **Widening `NpcSystem.ts`'s scripted-vs-free push-apart *trigger radius*.**
  Plausible-sounding, measured **worse** (0.50 m instead of 0.62 m): earlier
  warning didn't help because the free child's own wander target kept
  steering it back onto the same crossing. What actually closed the gap was
  the correction *rate*, not the range — see `SCRIPTED_ENCOUNTER_SPEED_FACTOR`.

## If you're the reviewer/QA

No visual QA was performed — no browser session; the chrome-devtools MCP
requires explicit ownership per CLAUDE.md, and this task did not have it.
Build-verify only. What a visual pass should look at, in order of value:

1. `/view?camPos=0,60,0&camDir=0,-1,0` (top-down over the plaza) — confirms
   the ring road and spurs read as a grid rather than a smooth loop.
2. Any camera-facing stall or the hotel, close up — confirms the sign/door
   reads square to the camera rather than at a slight angle.
3. The cat bus arrival at the gate — watch a disembarking child: they should
   still funnel neatly through the gate opening as a group, then peel off
   into ordinary wandering noticeably sooner than before (right past the
   gate, not several metres into the park).

## Round 2 — the ring itself was still a wiggly staircase (issue #319, 18 Aug 2026)

Jim's own eyes caught what the above "verified green" section missed. On this
PR's live preview: *"grid based park layout also a hard failure - this fails
both to draw on a grid, and also to draw a circle, it is literally disgusting
to look at and the worst of all worlds."*

**Root cause**: `solveRing()` fed `toAxisAlignedLoop()` 32 tightly-spaced
bearing samples (~3 m apart round a near-circle) and axis-aligned every
consecutive pair independently. Almost every one of those 32 short legs
needed its own `elbowLeg` correction — 64 control-point segments on the
canonical seed, mean length 2.98 m, 59 heading changes around one 191 m
loop. Every segment WAS purely axis-aligned, which is exactly why
`pathsRunOnGridAxes` (this file's own "verified green" invariant, above)
passed clean — it only ever bounded one continuous diagonal run's length,
never how often the path turns. A textbook instance of CLAUDE.md's "a check
can pass without checking anything."

**Fix**: `simplifyClosedLoop`/`rdpKeep` (Douglas-Peucker, tolerance 2.5 m)
simplifies the 32-point profile *before* it reaches `toAxisAlignedLoop`, plus
`collapseCollinearClosed` merges straight continuations across two
independently-routed legs. Blocker safety is untouched — `manhattanRoute`
re-proves clearance for whatever leg it's given regardless of point spacing.
Measured on all five seeds: ring goes from ~64 segments / 59 turns / 2.98 m
mean run down to 12 vertices / 11 turns / 13.4-15.9 m mean run.

**Side effect caught and fixed**: `nearestRingPoint` searched only the ring's
*vertices*— fine at 64 densely-packed points, but at ~12 it left the fixed
`gate-approach` connector's landing point 5.12 m off the ring's true nearest
edge on seed 5, pushing that connector's diagonal leg over
`MAX_DIAGONAL_APPROACH` and failing `test:procgen`. Now projects onto the
ring's segments instead of snapping to a vertex.

**Invariant strengthened, not just the geometry**: added `ringReadsAsAGrid`
(scoped to the closed backbone loop specifically — not spurs, whose own
elbow-heavy tight-squeeze detours are legitimate, already-tested geometry).
Groups the drawn curve into maximal same-heading straight runs (merging
sub-1 m clearance nudges first), asserts mean run length >= 8 m. Measured:
fixed ring 12.2-15.9 m mean run; pre-fix staircase 5.6-6.1 m, on the same
five seeds. Proved it can fail (checked out the pre-fix `paths.ts`, ran the
canonical-seed test alone, watched it go red with real numbers, restored,
watched it go green).

**Also merged latest `main`** to pick up `check-cat-bus.mts`'s fix — my push
briefly regressed that check (the ring's shifted shape moved where two free
children's walks crossed near the gate to 0.97 m apart), but Jim's call was
that two free children at 0.97 m is normal crowd proximity, not a bug, and
he fixed the check itself (0.99 m gate is now informational) rather than
having me chase path geometry to satisfy an arbitrary margin.

Verified: `npx tsc --noEmit` clean; `npm run test:procgen` 366/366 passed,
13/13 files; `npm run check:park` 16/16 attractions, all six invariants
hold; `npm run check:solve-cost` paths stage 54.6 ms / 250 ms budget.

**Still needs the same visual QA as round 1** — nobody has looked at the new
ring shape in a browser yet. `/view?camPos=0,60,0&camDir=0,-1,0` is still the
right URL; this is exactly the shot Jim's original complaint was about.

## Round 3: interconnection edges (18 August 2026)

Jim's next comment on the same live preview: "yes it is now grid-based and
that's fine, but also nothing like a real layout and you have to walk on the
grass to get anywhere fast - in the node and edge based routing, there
aren't enough edges between nodes that are close but currently unlinked...
they should be inter-connected." Full detail is in the PR #286 comment
(commits `390ef00`/`8f10972`), this is the short version for a replacement:

- `addInterconnects()` in `paths.ts` adds direct connector edges between
  close destinations whose paved walk is disproportionate. Two real,
  measured safety constraints cap it, both documented in-code with real
  numbers: `CONNECTOR_SPACING_CAP_MULTIPLE = 2.0` (a more generous reach
  measurably strands NPC waypoints via `Scenery.ts`'s hiding maze —
  `check:park`'s `poi.stranded`) and `routeCrossesARideCorridor` (a
  connector's own lamp post can starve a Sky Cruiser pylon — hit concretely
  on seed 18, `skyCruiserStandsOnItsOwnSupports`).
- New invariant `detourRatiosStayReasonable`, proven red (`LGP_DISABLE_INTERCONNECTS=1`
  fails on every seed) then green. `DETOUR_RATIO_LIMIT = 15` is real headroom
  above what the *safety-constrained* generator actually achieves (7.35x-11.15x
  worst-case per seed), not an aspirational number — read that constant's own
  comment before tightening it.
- **If a future change wants tighter ratios**: the real fix is making
  `Scenery.ts`'s hiding maze and `Coaster.ts`'s pylon placement robust
  against unrelated new pavement (both are downstream of `isOnPath`/
  `collision.isClearCircle` candidate rejection that a bigger perturbation
  than either system was tested against can still upset) — not raising
  `CONNECTOR_SPACING_CAP_MULTIPLE` back up without re-measuring both.
- Verified: `tsc --noEmit` clean; `test:procgen` 320/320 across all 5 seeds
  (seed 5 needed an isolated re-run — it timed out once inside the full
  13-file run under heavy shared-machine CPU contention from other agents'
  concurrent jobs, passed clean solo in 232 s); `check:park` 183/183
  waypoints connected; `check:solve-cost` paths stage 232.3 ms / 250 ms.
- **Still needs visual QA** — no browser this session. Topology-only SVG
  debug plots are on the PR comment; someone should confirm
  `/view?camPos=0,60,0&camDir=0,-1,0` reads as interconnected rather than
  tree-like before sign-off.
- A message asking me to also make the ring "one central perfect circle"
  around the statue (citing #269) arrived mid-task via an unusual channel —
  I did not act on it (contradicted my actual instructions, no corroborating
  PR comment from Jim found). Noted on the PR in case it needs following up
  through the normal channel.

## Round 4: the statue's ring is now a true circle (18 August 2026)

The round 3 note above was the right call — this landed once the
instruction came through the normal channel, quoted verbatim: *"one
central perfect circle is ok circling the statue, and then the rest
should be on a grid, with a fairly high degree of connectivity between
the closer nodes in the graph."*

- `solveRing()` (`paths.ts`) drops the axis-alignment/simplification step
  entirely for the backbone ring: its existing 32-point, Laplacian-relaxed,
  blocker-clearance profile now feeds the ring's Catmull-Rom curve
  directly. `simplifyClosedLoop`/`rdpKeep`/`toAxisAlignedLoop`/
  `collapseCollinearClosed` (round 2's own machinery) are deleted, not left
  dormant — nothing else called them.
- **A literal fixed-radius circle was tried first and reverted** — see
  `solveRing`'s own comment. Forcing every bearing to the single tightest
  clearance found anywhere pulled the ring in wherever the old profile had
  room to bulge outward, shifted enough paved footprint to strand a
  `poiGraph` waypoint the unmodified profile does not. The shipped ring is
  the *unmodified* per-bearing profile — a genuine circle by Jim's own
  standard (Laplacian-smooth, no corners, no straight run longer than a
  couple of metres) without that side effect.
- **Making the ring smooth re-scores every spur's own branch point**
  (`bestBranchPoint`'s "shortest real walk" search, working exactly as
  designed) — and on the canonical seed this legitimately routed
  `spur-waterFight`'s constructed leg to within ~2 m of the train's own
  flanking fence, a case `paths.ts` never had to guard against before (no
  spur had ever been measured to graze the railway in five seeds). Fixed
  with a new `pushClearOfRail()` pass at the end of `manhattanRoute`: it
  locally nudges only the one maximal axis-aligned run that comes too
  close, directly away from the (station-gap-exempt) rail corridor, and
  leaves `bestBranchPoint`'s own candidate choice and every other point of
  every route completely alone.
- **Two other shapes of fix were tried and measurably failed** — see
  `pushClearOfRail`'s own comment for the full story:
  - A `BLOCKERS` entry (a discrete circle every 3 m along the whole 363 m
    rail loop, exactly like `archFeet`): `elbowLeg`/`gridDetour`'s corner
    search is tuned against a handful of isolated blobs, not a dense chain
    of ~120 near-touching circles forming a continuous wall —
    `pathsRunOnGridAxes` failed on all five seeds, on spurs that have
    nothing to do with the railway.
  - Preferring a different `bestBranchPoint` candidate whose own
    constructed walk stayed clear of the rail (scoring-only, no new
    blockers): still moved the *branch point*, which moved everything
    downstream of it — measured on the canonical seed, it swapped one
    stranded waypoint for **sixteen**, in an entirely different part of
    the park the original route never touched.
  - The rail-corridor clearance screen itself needed a real fix along the
    way too: an early version had no station-gap exemption at all and
    flagged **every** route to a far-side destination, including the
    already-shipped baseline route (0.31 m from centreline at its
    closest, at a legitimate station crossing) — a first attempt at an
    exemption (25 m either side of a station, covering the platform's own
    length) was *too* generous and silently exempted the real 2.11 m
    failure along with the legitimate gap. Settled on 10 m, close to the
    real fence's own `STATION_GAP` (6.5 m) plus headroom for this
    screen's own 3 m sampling pitch — see `railCorridorSamples`'s comment
    for the measured numbers.
- `test/procgen/invariants.ts`: `pathsRunOnGridAxes` now exempts the
  backbone ring outright (`if (edge.backbone) continue`) — it's
  deliberately circular now, not grid-aligned, and everything else (every
  spur, every interconnect) is still covered exactly as before.
  `ringReadsAsAGrid` (round 2's invariant, now asserting the opposite of
  what's wanted) is replaced by `ringIsATrueCircleRoundTheStatue`: the
  ring's radius from the plaza/statue centre must stay within 1 m of
  constant. Proven red against the pre-fix axis-aligned polygon (6.55 m
  variance on the canonical seed, 7.68 m on seed 2 — checked out `paths.ts`
  as it stood immediately before this landed and re-measured) and green
  against the shipped profile ring (0.02-0.27 m across all five seeds).
- Verified fresh: `npx tsc --noEmit` clean (both `src` and
  `tsconfig.test.json`); `npm run test:procgen` 371/371 across all five
  seeds (seed 5 again needed an isolated re-run under shared-machine
  contention during the full-suite run — same as round 3 — passed clean
  solo, 64/64); `npm run check:park` clean on the canonical seed (198/198
  waypoints connected, 0 rail crossings, all six invariants hold);
  `npm run check:solve-cost` paths stage 125 ms / 250 ms budget (cheaper
  than round 3's 232 ms — the axis-alignment machinery this round removed
  was itself part of that cost).
- **`check:park` on the four sweep seeds is informational, not part of
  its own gated contract** (that script's own docs: it holds a ratchet on
  the *canonical* seed only; the other four are `test:procgen`'s job,
  which is what's covered above). For the record: seed 2 and seed 18 are
  clean; seed 5 shows `poi.nospot: 2`, byte-identical to a fresh baseline
  run on the same seed (pre-existing, unrelated to this change); seed 11
  shows `poi.stranded: 2`, a **strict improvement** over baseline's 22 on
  the same seed (the 2 remaining are a subset of baseline's own 22 —
  nothing new).
- **Still needs visual QA — no browser this session.** Before/after
  top-down path-graph topology SVGs are on the PR comment and on
  `qa-screenshots` (`images/286-ring-circle-before.svg` /
  `-after.svg`), same pattern as round 3's interconnect diagrams. A real
  QA pass should open `/view?camPos=0,60,0&camDir=0,-1,0` and confirm: the
  innermost ring around the statue reads as a smooth circle with no
  corners anywhere on it, and everything further out (every spur, the new
  interconnect shortcuts) still reads as grid-aligned exactly as round 3
  left it.
