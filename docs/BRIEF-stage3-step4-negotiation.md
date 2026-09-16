# Engineering brief — stage 3, step 4: refusals reach the scheduler, and the scheduler learns to unwind

**Status: HELD — no customer (6 Sep, after Jim's road rule).** Jim ruled
*"just skip all the legs over the road, otherwise keep them — one simple
rule is all we need here"* (design doc, "The road rule (Jim, 6 Sep)"). A
trestle refused by the road is skipped, never negotiated, and the road is
never refused by a trestle, so the pair this step was written for has
nothing to negotiate, and building the ladder against it would be a
mechanism exercised by a check that cannot fail. **Do not dispatch this
step until a placer genuinely returns a refusal that a blocker can clear**
— expected to be stage 4's paths (an unserved door demand whose blocker is
a plot). When that customer exists, the mechanics below are the brief;
re-verify every code fact first. Branch from
`design/round-robin-generation`. One engineer, one worktree, Fable.
Authority: `docs/DESIGN-round-robin-generation.md` — "Totality, ruled and
mechanised (Jim, 6 Sep)" (the unwind ladder with its four named rungs),
"Backtracking, one mechanism instead of six", "A feature's own supports are
claims", "Stage 3, ruled", "Steps 3 and 4, re-cut (6 Sep)".

**The bar is Jim's totality ruling, and this is the step that makes it
mechanical for the first pair:** a placer never throws on a seed's geometry
— it returns a *refusal* naming its blockers; the scheduler answers with
the ladder (retry → negotiate → unwind → decision zero); reaching decision
zero is legal and counted, equivalent to another seed; and **a refusal that
survives every rung is a generator bug, reported with its whole chain —
never a property of the seed, never a warp, never a retired seed.** The
earlier draft of this brief ended its unwind order in "a loud failure
naming the seed" as if that were a designed terminal state. It is not. It
is the one legal throw — exhausted budget at decision zero — and it means
the generator is wrong.

## What the code is on the day you start (read, 6 Sep — re-verify)

- `GroundClaims` (`src/boot/groundClaims.ts`) already has the structured
  refusal: `allows(feature, claim)`, `blockers(feature, claims)` returning
  `readonly Refusal[]` (`{ feature, kind }`, distinct, in commit order —
  the backjumping hint), `withdraw(feature)`, and re-commit keeps a
  feature's order. It throws nowhere. 20 tests.
- `CoSolveEngine` (`src/boot/coSolve.ts`) is **test-only** (13 tests) and
  typed against `PlacementField`, a second registry nothing in production
  uses. It carries exactly the mechanics this step needs — `attempt` per
  feature, `blockers?()`, `backtrackFor`, `pickBlocker`, `withdraw`,
  `restart`, `backtracks`/`restartCounts` counters, `maxBacktracks` — and
  a `place(field, attempt)` contract whose doc already says a retry "must
  search *differently* (salt its randomness with `attempt`)".
- `SolveScheduler` (`src/boot/solveScheduler.ts`) is the production
  scheduler: slicing, `'frame'` yields, `ready()`, `deps`, overrun counters,
  12 tests. It has **no** notion of refusal, attempt, withdraw or restart;
  a task that throws is recorded `failed` and the generation stops.
- After step 3 the pair is two real tasks (`roadCorridor` +
  `roadCorridorRealised`, `railRaceSupports`) on the live registry, and a
  refused mandatory duck-bar slot still **throws** from `track.ts`
  (~L1552, "no support can stand for the duck bar at slot N of … lean limit
  reached … refused by road"), naming its blockers. On the hill that throw
  fired on 12 of 14 seeds; on the sphere, with the road outside the ring,
  step 2 expects 0. **Whatever the sphere number is when you start, quote
  it first** — it is this step's "before".

## The rule a reviewer looks for first

**Three askers, one function.** The search's exploration query, the claim's
commit check, and the negotiation's "who blocks me / would it work if I
changed?" all come from `GroundClaims`' own predicates (`allows`,
`blockers`) — never a re-derivation. A negotiation reasoning about
geometry the registry did not compute is a fourth ground model and a
rejection on sight.

## What this step is — in order

### 1. One scheduler. `SolveScheduler` absorbs the engine; `CoSolveEngine` and `PlacementField` are deleted

Two schedulers with a sign saying which is dead was the interim; it ends
here. **`SolveScheduler` is the survivor** (it runs real parks under a frame
budget); it gains from `CoSolveEngine`, moved not rewritten:

- A task may finish its `start()` generator by **returning a refusal**
  instead of `void`: `Generator<number | 'frame', Refused | void, void>`
  where `Refused = { readonly blockers: readonly Refusal[]; readonly consumed?:
  readonly Decision[] }` — blockers from `GroundClaims.blockers()`; `consumed`
  for a search that failed against its own inputs (the totality ruling's
  second form — not needed by this pair, but the type carries it so the
  next placer does not invent a second shape).
- Per task: `attempt` (0-based, folded into `decisionStream(seed, feature,
  decision, attempt)` from step 3), `withdraw` (the registry's, plus the
  task's own letterboxed output), and **the ladder**, in the ruled order and
  no other:
  1. **retry** — the refused task runs again at `attempt + 1`;
  2. **negotiate** — the **most recently committed** blocker is withdrawn
     and re-run at *its* `attempt + 1`, then the refused task at its own
     next attempt;
  3. **unwind** — backjump to the most recent decision among the blockers
     (or consumed inputs): withdraw everything committed after it, re-run
     it at `attempt + 1`, replay forward; repeat one decision further back
     each time until the refusal clears;
  4. **decision zero (scheduler)** — withdraw every task's commit, bump the
     scheduler-level attempt, replay all tasks. Counted, never silent.
- **Budgets are derived, never typed**: a task's retry budget is its own
  candidate supply (the road's outset march is bounded by the extents of
  the claims that refuse it — each attempt is the nearest outset past the
  refusing claim, so the sequence is finite by construction; the trestle
  march is exhaustive over lean × arc and reports exhaustion as its
  refusal); the unwind budget is the number of decisions to unwind
  through; the scheduler-level restart budget is the one number that must
  come from somewhere — take `CoSolveEngine`'s `maxBacktracks` semantics
  and derive it from the task count, and say in the PR body that it is the
  one number you could not derive from the search if that is true.
- Exhausting the budget at decision zero is **the one legal throw**, and it
  carries the whole chain (every refusal, every rung taken, the coordinates
  of the last refused claim).
- `test/coSolve.test.ts`'s 13 cases re-point at `SolveScheduler` +
  `GroundClaims` (the behaviours survive; the fixtures change from
  `Obstacle` discs to claims); `coSolve.ts` and `PlacementField` are
  deleted; `groundClaims.ts`'s header no longer says it "widens
  `PlacementField`".

### 2. The trestle throw becomes a refusal; the road's outset is the negotiated decision

- `track.ts` ~L1552 stops throwing. A mandatory slot with no support makes
  the `railRaceSupports` task return `Refused` with the registry's
  `blockers()` for the last tree it asked with (plus any legacy predicate by
  name, per the 6 Sep ruling). The message text that named the slot, the
  lean, the arc room and the blockers survives as the trace line.
- **Retry** on the trestle task is empty by construction (the march was
  exhaustive) — the scheduler must see that and go to **negotiate** at
  once, not re-run an exhaustive search N times. Make "this task has no
  further attempts" a return value, not a timeout.
- **Negotiate**: the most recent blocker is the road (it committed before
  the trestles by `deps`). The road's `attempt + 1` is **the next outset
  past the refusing claim's extent** — read from the blocker's claim shape
  through the registry, never a typed step. The road never moves *inside*
  the ring's band (the 8.26 floor from the bus door is the floor, one
  owner), the ring does not move (family brief — it is not a decision).
- **Support shape** is the trestle's *own* next decision when its lean is
  exhausted — design ruling point 3; `forkPlan` rising vertically to the
  headroom before it forks — and it is **built only if something exercises
  it**. Decide by measurement on the sphere at the start: if no seed's
  trestle refusal survives the road's negotiation, the shape is not built
  (a rung nothing can reach is a check that cannot fail); the PR says so in
  one line with the per-seed number. If any seed needs it, request the
  geometry from the 3D Artist rather than authoring it inline, and it goes
  between retry and negotiate as the trestle's second attempt.
- **Decision zero from this pair** is expected to be unreachable by
  construction (the road's outward march terminates allowed on a sphere).
  Prove it is *wired* anyway (acceptance 2) — under a scratch flag that
  freezes the road's outset, the chain must run negotiate → unwind →
  scheduler decision zero → budget exhausted → the one throw with the chain
  attached. That transcript, with geometry, is the definition of "the
  refusal path is real".
- **The layout's decision zero** (`parkLayout.ts`'s restart loop, #596's
  `attempts`) is **not** reachable from a scheduler refusal in this step:
  `PARK_LAYOUT` is a module constant, not a task. Say so in the PR body and
  in the trace ("scheduler decision zero; layout not re-drawn — stage 4"),
  so nobody reads the scheduler's restart as the whole ladder. Wiring the
  layout in is stage 4's (when it becomes a task); do not smuggle it.

### 3. Counters — the design's first thrash measurement

Printed to **stderr** on every procgen run, per seed, through step 3's one
trace owner (not a second printer): refusals per task, negotiations,
unwinds (with depth), scheduler decision-zero count, attempts consumed per
task, and "support shape: not built / fired N times". Folded into the park
digest's `trace` line so a seed that starts needing an unwind changes its
digest **by name**. `check:every-seed-builds` (#596) reads these lines for
its **built well** ratchet; extend its parser, do not add a check.

## What must not change

- Every clearance: `check:swept-bus` at 0 on every seed; the ring-support
  invariants (`railRaceTrestlesCarryEveryTrack`, `supportsMeetWhatTheyCarry`,
  the 40 m `TRESTLE_GAP_TOLERANCE` run) and the duck-bar invariants
  (`duckBarsStandOnRealSupports`, `duckBarsAreOnePerLaneAndNeverTouch`) green
  on every seed.
- No new named pairings. Anything the negotiation must know about a
  feature enters `CLAIM_COMPATIBILITY` or a claim kind, in the open.
- Determinism: blocker choice (most recent, from the registry's commit
  order), retry order (fixed round order) and every attempt counter folded
  into the stream name — never map iteration, never a global counter,
  never `Date`.
- The other six tasks' gating and order; the failure semantics in
  `parkGeneration.ts`'s header for tasks that are not this pair (their
  throws are stage 4/5's to retire, in the open, one by one).

## Acceptance — measured, quoted off the screen

1. `coSolve.ts` and `PlacementField` gone; `SolveScheduler` carries the
   ladder; the 13 re-pointed tests plus the scheduler's 12 green, and new
   tests for each rung (retry, negotiate, unwind, decision zero) that are
   **watched red** by removing the rung.
2. **The refusal path watched running to the end**: scratch flag freezing
   the road's outset → transcript showing the trestle refusal, negotiate
   attempted and refused (road frozen), unwind, scheduler decision zero
   counted, budget exhausted, the one throw carrying the chain with
   coordinates. Pasted with the geometry it was proved against (the seed,
   the slot, the blocking claim's capsule).
3. **Then, flag off**: every pool seed builds with **zero refusals
   surviving**, and the counters say how many were cleared at which rung.
   Per seed, quoted. If any seed's refusal survives with the flag off, the
   PR does not open — that is the bug this step exists to find.
4. **Change accounting**: seeds where no negotiation fired hash identical
   to step 3's (digest, including the trace line); every other change named
   with the rung that caused it. Countersigned by the Architect. Any moved
   foot or road is visible work: `/spawn?pos=…` at it, one sentence, Jim.
5. Support shape: built or not built, with the measurement that decided it.
6. Full gates, exit codes read directly: `pnpm run check` (chain parsed,
   step set compared), `pnpm run test:procgen`, `pnpm run build`,
   `check:coplanar`, `check:swept-bus`, `check:park-pool`,
   `check:every-seed-builds` if #596 has landed.
7. **The stage-3 decision point, answered in the PR body**: does this beat
   the hand fix on #498's stakes — bus clear of every post at height on
   every seed, rings supported, no named pairing, no warp or terrain change,
   and the next feature placed near either covered with zero new code? The
   Architect takes that answer to the Overseer to green-light stage 4.

## Traps

- `CoSolveEngine.place()` returns obstacles; a `SolveScheduler` task commits
  claims itself inside its turn. Keep the second shape — the registry is the
  record, the task's return value is only the refusal.
- Withdrawing a task must also empty what it letterboxed (the trestle
  spots, the road's segments); a `World` built from a stale letterbox after
  an unwind is the "claim copied from a route" disease one step removed.
- `check:park-boot`'s ceiling: an unwind replays tasks — replay slices too.
- `rerere`; parse the chain; three-dot diff; never build the park twice in
  one process.
