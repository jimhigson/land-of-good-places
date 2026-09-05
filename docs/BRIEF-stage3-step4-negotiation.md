# Engineering brief — stage 3, step 4: the first support-shape negotiation, and the engine moves onto the registry

**Status: HELD until step 3 merges; its size is set by the five-seed
measurement** (design doc, "Stage 3, ruled"). Re-cut 5 Sep: there is no
named clause to delete — none reached `main` — so the earlier "the clause
comes out" brief is void; this is what stands in its place. Authority:
`docs/DESIGN-round-robin-generation.md` ("Stage 3, ruled" ruling points
1–3, "Backtracking, one mechanism instead of six", "A feature's own
supports are claims"). One engineer, one worktree.

## The rule a reviewer looks for first

**Three askers, one function.** The search's exploration query, the
claim's commit check, and the negotiation's "who blocks me / would it work
if I changed shape?" all come from `GroundClaims`' own predicates
(`allows`, `blockers`) — never a re-derivation. A negotiation reasoning
about geometry the registry did not compute is a fourth ground model.

## What this step is

- **`CoSolveEngine` migrates onto `GroundClaims`.** `coSolve.ts` is
  test-only today and types against the superseded `PlacementField`; the
  engine's round-robin/backtracking mechanics carry forward, its field
  becomes the one production registry, and `PlacementField` is deleted
  (two registries with a sign saying which is dead was the interim; the
  interim ends here).
- **The refusal path runs across the feature boundary for the pair**:
  a trestle whose nearest allowed foot leaves its trunk in the corridor
  at height gets a different support shape (step 2's dormant bullet,
  now live if the measurement says so); if no shape serves the ring, the
  refusal propagates via `blockers()` — the road's outset is its own
  freedom above the 8.26 floor (it may move further out, per step 2's
  derivation), the ring does not move (family brief), and the road never
  goes *inside* the ring's band — so the unwind order is: support shape,
  then the road's outset, then a loud failure naming the seed. That
  failure must be reachable and must be watched happening in a scratch
  build (disable the shape choice, run the pool, paste the red transcript
  with geometry).
- **Budget counters ship and report**: refusals-per-leg, shape-changes-
  per-seed, retries-per-placer for the pair, printed to stderr on every
  procgen run — the design's first thrash measurement. Record the numbers
  in the PR; they decide when forward checking / most-constrained-first
  get built.
- **If the measurement shows the sphere alone clears posts at height**:
  the shape negotiation is not built (nothing would exercise it — a check
  that cannot fail); this step shrinks to the engine migration plus the
  counters, and says so in the PR body.

## What must not change

- Every clearance stands: step 2a's instrument at zero on every seed; the
  40 m ring-support and duck-bar invariants green.
- No new named pairings. Anything the negotiation must know about a
  feature enters the compatibility table or a claim kind, in the open.
- Determinism: blocker choice and retry order from the fixed round order
  and per-placer substreams, never map iteration.

## Acceptance — measured

1. `PlacementField` gone; `CoSolveEngine` on `GroundClaims`; its tests
   (`test/coSolve.test.ts`) re-pointed and green.
2. The loud-failure path watched happening (transcript with geometry),
   then the pool green with the shape choice enabled.
3. Counters on stderr per seed; numbers quoted.
4. Per-seed park-hash accounting: seeds where no negotiation fired hash
   identical to step 3's; every other change named. Countersigned by the
   Architect.
5. Full gates green, exit codes captured directly.
6. **The stage-3 decision point answered in the PR body**: does this beat
   the hand fix (#498's stakes: bus clear of every post at height on all
   sixteen seeds, rings supported, no named pairing, no warp or terrain
   change, next neighbour covered with zero new code)? The Architect takes
   that answer to the Overseer to green-light stage 4.
