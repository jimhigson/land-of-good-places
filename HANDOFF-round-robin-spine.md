# HANDOFF — round-robin generation spine (stages 1–2 of the ruled design)

**This agent runs `claude-fable-5` (Fable 5), chosen by Jim** — per CLAUDE.md,
a replacement runs the same model. Branch `feat/round-robin-spine` off
`origin/main`, worktree `.claude/worktrees/round-robin-spine`.

**The authority is `docs/DESIGN-round-robin-generation.md` on
`design/round-robin-generation`** — ruled by Jim in direct conversation, 3 Sep,
and greenlit for implementation ("time to implement this and hand over to the
overseer when ready"). Read it before touching this branch. It supersedes
`design/ground-claims` in plan-shape (round-robin is the spine, not stage 5).

## Done

- **`src/boot/groundClaims.ts`** — the claims registry: four claim kinds
  (footprint / corridor / walkable / surface) over disc + capsule geometry,
  `CLAIM_COMPATIBILITY` as exported data (one law for generator AND the
  future universal invariant), declared crossings gating corridor×corridor,
  demands ("a paved corridor must terminate here") with `unservedDemands()`,
  and `blockers()` in commit order for backjumping.
  - **Trap found and fixed**: a single deepest-overlap *witness point* cannot
    gate the crossing exemption — parallel lane-shares tie along the whole
    run and the tie-break can land inside a zone the overlap merely grazes.
    `overlapConfinedToZone` marches core samples instead; the unit test
    "a parallel lane-share that grazes the crossing zone is still refused"
    is the red-proof (it failed the witness version live, then passed).
- **`test/groundClaims.test.ts`** — 17 tests: table symmetry, every kind
  pairing both directions, overlap AND clear for each geometry pairing,
  crossing-as-gate-not-hole, blockers order, demand serve/unserve/re-unserve.

## Done (cont.) — stage 2: the spine is landed and proven byte-identical

- **`src/boot/solveScheduler.ts`** gained three additive features (5 new
  tests, 12 total green): `ready()` start gates (a task whose module has not
  landed is held un-started, never busy-yielded), `'frame'` yields (a task
  ends its own frame — the slide's judge-on-its-own-frame rule), and
  `progressOf`/`isDone` for drivers.
- **`src/boot/parkGeneration.ts` rewritten**: the hand-ordered phase chain is
  now ONE SolveScheduler with seven tasks (brief, cruiserSearch,
  cruiserFinish, trainSearch, slideSearch, crossingSites, pathGraph) whose
  deps reproduce the old order exactly, plus a gated import ladder (imports
  are chunk loading, not placement — they stay the driver's business, one per
  frame). Public API unchanged (stage/unitCounts/attempts/lateSteps...).
- **Proof**: `check:park-boot` exit 0 — sliced vs straight-through hashes
  IDENTICAL for slide route, chute, and cruiser loop. Traps handled: judge
  and next-rung brief must not share a frame ('frame' yield after a failed
  judgement); slide brief is evaluated eagerly as railRouteSearch's argument
  so it lands on its own slice.

## In flight

Full gates running in background at the rewrite commit: `pnpm run check`
(58 steps), `test:procgen` (whole pool), `check:coplanar`, `build` — outputs
to /tmp/rr-*.out, exit codes appended. Anything red gets root-caused before
handover; procgen baseline on main is expected-green (branch is off main,
untouched procgen).

## Next (in order)

1. **Universal deny-by-default overlap invariant** on ParkFacts, importing
   `CLAIM_COMPATIBILITY` from groundClaims (one law, two readers). Expected
   red on first run — that list is the deliverable, triaged not exempted.
   NOT started while the background gates run (editing test/procgen mid-run
   would corrupt the measurement).
2. First placer migration onto claims (stage 3, design doc): entrance road +
   rail-race trestles pair, measured against fix/road-487-488.
3. Engine generalisation: CoSolveEngine commits Obstacle[] discs; migrate to
   GroundClaims contributions (claims + crossings + demands), then wire
   backtracking into the spine as placers migrate.

## Discipline learned/relearned this leg

- I piped a test run through `tail` and read `exit=0` off the tail's code —
  the exact CLAUDE.md sin. Redirect to a file, capture `$?` immediately.
- check chain is 58 steps now; also `check:coplanar` is separate and required
  before push per the updated CLAUDE.md in this worktree.

No PR yet. Jim's instruction: implement, then hand to the Overseer when ready.

## The stack, for whoever rebases

- **PR #499** = `feat/round-robin-spine` (registry + scheduler features + the
  one-scheduler driver + this handoff). At review; may merge first. I do not
  merge it.
- **`feat/universal-overlap-invariant`** is stacked on the spine at the
  handoff commit. Everything on it beyond #499's HEAD is invariant work only
  (test/procgen + any shared-geometry helpers). If the spine merges first:
  rebase this branch onto main and the diff should collapse to exactly the
  invariant commits — three-dot diff it and account for every file.
- Expected state of the invariant branch: RED against real parks on first
  honest run. That red list is the deliverable — real defects with
  measurements, reported to the Overseer, never exempted. A pair genuinely
  allowed to overlap is a CLAIM_COMPATIBILITY entry with a stated reason.

## Universal overlap invariant — BUILT, HONESTLY RED, findings filed (3 Sep, Fable)

On `feat/universal-overlap-invariant` (stacked on the spine): 'no two drawn
features share ground the law forbids' — deny-by-default any-pair sweep,
CLAIM_COMPATIBILITY imported from groundClaims, coverage announced on stderr.
First honest run: red on all 5 pool seeds, 36 residual findings after one
ruled legality (station boarding gaps, read from world.train.stations —
corridors only). Defects filed with measurements: #500 (bushes through
walls/trees, up to 1.69 m) and #501 (train drives through slide legs, worst
leg 0.12 m from the rail centre line). THE INVARIANT MUST NOT BE EXEMPTED —
it goes green when the defects are fixed. Raw outputs: /tmp/uo-pool.out,
/tmp/uo-r2.out, /tmp/uo-r3.out.

Traps for a successor: ribbon findings must aggregate per label-pair or one
defect floods as hundreds of half-metre capsules; plots/castle are swept as
INSCRIBED capsules (corner overlaps missed, stated in the doc comment);
entrances/exits are points until doormats can be tied to their own plot.
