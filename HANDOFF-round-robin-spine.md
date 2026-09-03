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

## Next (in order)

1. **Scheduler lands byte-identical (stage 2, the un-skippable one).**
   `src/boot/parkGeneration.ts` is the driver: currently a hand-ordered
   dependency chain; `SolveScheduler` (no backtracking) already hosts train /
   crossing-sites / path-graph solves; `CoSolveEngine` (`src/boot/coSolve.ts`,
   round-robin + backtracking + blockers + dep cascade, ten unit tests) is
   built and wired into nothing. Plan: drive placers through the engine with
   un-migrated placers running whole in their slot; prove byte-identity by
   hashing the generated park per seed before/after (check:park-boot's
   "sliced equals straight-through" is the precedent).
2. **Universal deny-by-default overlap invariant** on ParkFacts, importing
   `CLAIM_COMPATIBILITY`. Expected red on first run — that list is the
   deliverable, triaged not exempted.
3. Engine generalisation: `CoSolveEngine` commits `Obstacle[]` discs; migrate
   it to `GroundClaims` contributions (claims + crossings + demands).

## Discipline learned/relearned this leg

- I piped a test run through `tail` and read `exit=0` off the tail's code —
  the exact CLAUDE.md sin. Redirect to a file, capture `$?` immediately.
- check chain is 58 steps now; also `check:coplanar` is separate and required
  before push per the updated CLAUDE.md in this worktree.

No PR yet. Jim's instruction: implement, then hand to the Overseer when ready.
