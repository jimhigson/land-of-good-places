# Engineering brief — stage 3, step 3: confront the import ladder

**Status: HELD until step 2 merges; re-cut 6 Sep against the code as it
stands** (step 1 = #585 on `main`; step 2 = `feat/procgen-step2-trestles-claim`,
phase 2 pending the sphere). Branch from `design/round-robin-generation`
(it is `main` plus these docs; check `src/boot/parkGeneration.ts` registers a
`roadCorridor` task where you branch). One engineer, one worktree, Fable.
Authority: `docs/DESIGN-round-robin-generation.md` — "Totality, ruled and
mechanised (Jim, 6 Sep)", "Stage 3, specified", "Stage 3, ruled", and
"Steps 3 and 4, re-cut (6 Sep)" — and `parkGeneration.ts`'s module header.

**The bar, from Jim's totality ruling, applies to every line of this step:**
no seed is unbuildable; a placer that cannot place *returns a refusal naming
its blockers*, never throws on a seed's geometry; a throw is for programming
errors and exhausted budgets only, and carries the whole refusal chain.
Step 3 does **not** build the unwind (step 4) — but it must not add a single
throw on geometry, and everything it builds must be shaped so step 4 can
consume a refusal without rewriting it.

## What the code actually is on the day you start (read, 6 Sep — re-verify)

Two facts the earlier draft of this brief did not state, and an engineer
would have had to ask about:

1. **The trestle placer is not a scheduler task.** Step 2 makes each leg a
   claim asked of `GroundClaims`, but `trestleSpots(...)` still runs at
   `RailRace` construction inside `new World(...)` (`World.ts` ~L335, after
   the entrance), against `World.groundClaims` (the generator's registry,
   taken from the letterbox). There is nothing on the trestle side for the
   scheduler to interleave until this step makes one. That is the bulk of
   this step.
2. **The road task cannot take a turn early.** `parkGeneration.ts` registers
   eight tasks — `brief`, `cruiserSearch`, `cruiserFinish`, `trainSearch`,
   `slideSearch`, `crossingSites`, `pathGraph`, `roadCorridor` — and
   `roadCorridor` is declared `deps: ['pathGraph']` with `ready()` =
   `roadModule !== null` (its module is an ungated ladder rung). So the road
   is last by *declaration*, not by data: its provisional corridor needs
   only the layout and the boundary. The `pathGraph` dep exists for the
   *second* turn (the spur's realised end reads the paving), and today that
   second turn is not a turn at all — it is `World.ts` ~L306 re-committing
   after `Entrance`, and the paving is published by `buildPaths()` (a draw
   function, `pathGraph.ts` ~L249) rather than by the `pathGraph` task.

The `SolveScheduler` contract you are extending (`src/boot/solveScheduler.ts`,
12 tests): `deps` say what *work* must be finished; `ready()` says whether
the world outside the scheduler is ready, asked fresh each time an unstarted
task comes up; a task yields a **number** (progress; may get another slice
this frame) or **`'frame'`** (done for this `advance()`; next slice next
frame). Do not overload either value.

## The rule a reviewer looks for first

**The exploration query and the commit check must be the same function**, and
**a query is answered by the live registry**. Once the road and trestle
tasks alternate, a read from a snapshot, a module top-level, or a cached
overview is a stale read that commit will contradict. Any such cache in the
diff is a rejection — including `World.groundClaims` being read by a placer
that should be asking the generator's registry inside its own turn.

## What this step is — four things, in this order

### 1. The trestles become a task: `railRaceSupports`

- One scheduler task, name `railRaceSupports`, that runs `trestleSpots` for
  **both** rings (walk-past first, race ring second — the claim order step 2
  made of the construction-order trick) against the generator's registry
  (`this.claims` in `ParkGeneration`), yielding a progress number **per
  slot** so it slices under `GENERATION_BUDGET_MS` (8 ms; `check:park-boot`
  asserts the per-`advance()` ceiling, 8 + 12 × slowness ms).
- Its output — the `TrestleSpot[]` per ring, each carrying the tree and the
  claims exactly as committed — goes to `World` through a letterbox of the
  same shape as `groundClaimsPrewarm.ts` (take-once; no module singleton),
  and `RailRace` **consumes** it. `RailRace` may re-solve only when the
  letterbox is empty (headless parks, tests), the way `COASTER_PLANS`
  re-solves; when it re-solves it must produce the same spots (assert it in
  `check:ground-claims`: letterboxed spots byte-equal to a construction-time
  re-solve on one seed — the "claim is the route" rule for supports).
- **`ready()` is a data-readiness gate, never a task-completion gate**: the
  rail-race plan module loaded (`railRace/plan` is an ungated rung today) and
  whatever `legacyGroundIsClear` still needs (below). **`deps`** name only
  what the search actually reads: the road's *provisional* claim
  (`roadCorridor`'s first turn) and nothing else — not `pathGraph`, unless
  measurement says the paths predicate changes a foot (below).
- **`collision.isClearCircle(x, z, 1.1)` has no generation-time owner** —
  there is no `CollisionWorld` in the scheduler. Do not invent one. Measure
  first, in a scratch run on every pool seed: log every candidate that
  `collision.isClearCircle` refused **and** the other three predicates
  (`distanceToPath`, `distanceToRailCorridor`, `PARK_LAYOUT` bounding)
  allowed. If that count is **0 on every seed**, drop the collision
  predicate from the task with the number quoted in the PR. If it is not,
  name what the collider was (a wall, a tree, a castle turret) and add
  *that thing's own generation-time owner* as a named legacy predicate
  (`legacy:<owner>`), never a copy of its geometry — and file it on the
  stage-5 migration checklist. Either way the universal overlap invariant,
  `railRaceSupportsAreClaimedAsDrawn` and `check:swept-bus` are the
  instruments that say nothing was lost; the leg digest per seed says what
  moved.
- The step-2 throw on a refused mandatory slot (`track.ts` ~L1552,
  "refused by …") is **left as it is in this step** — it is loud and names
  blockers, and converting it to a scheduler refusal is step 4's whole
  point. What you must do: make sure the message's blocker list comes from
  `GroundClaims.blockers()` plus the legacy predicate's own name (ruled in
  `HANDOFF-architect-procgen.md`, 6 Sep, point 4), so step 4 only changes
  *where* it goes, not *what* it says.

### 2. The road becomes a genuine two-turn task

- **First turn — provisional**: `deps: []`, `ready()` = module loaded. It
  commits the provisional corridor (spur end at generation, z = 52.00 on the
  canonical seed) on its first slice, so the trestle task can see it while
  the cruiser, train and slide are still solving.
- **Second turn — realised**: a second task, `roadCorridorRealised`,
  `deps: ['pathGraph', 'roadCorridor']`, that re-commits the corridor on the
  same feature name (`GroundClaims.commit` keeps a feature's order across
  re-commits) with the spur's realised end. For that to be a *turn*, the
  paving must be published at generation, not at draw: **move the
  `publishPaving(...)` call out of `buildPaths()` into the `pathGraph`
  task**, publishing the same `samples` and `PLAZA` disc from the graph the
  task already solved. `buildPaths()` then draws what was published and
  publishes nothing. This is the one piece of stage-4 work brought forward
  (the design doc's stage-4 filing now says so); the paths themselves do
  **not** migrate here.
- The `World.ts` ~L306 re-commit after `Entrance` is then deleted, and
  `check:ground-claims` probe on the realised spur end (z 55.91 canonical)
  reads it from the letterboxed registry. Keep the invariant
  `theRoadsCorridorIsTheRoadItDrew` green.
- **Order of legs against the road**: step 2 chose to build legs after the
  realised re-commit. With the trestle task depending on the *provisional*
  corridor, the spur end moving 3.9 m must be shown not to reach any foot
  (measure, all seeds — step 2's brief asked the same and its PR says
  which it chose; reuse its measurement), **or** `railRaceSupports` depends
  on `roadCorridorRealised`. State which, with the number. If the realised
  dep is needed, interleaving still happens (the trestles run alongside
  everything after `pathGraph`, before nothing) — say so honestly in the
  trace rather than claiming more.

### 3. The decision log and the substreams — the owner lands here

The totality ruling numbers every decision `(feature, decisionName,
attempt)` and draws it from `hash(seed, feature, decisionName, attempt)`.
No such owner exists in `src/` (grep `substream`, `placerName`,
`hash(seed` — nothing). Land it:

- One module, `src/boot/decisionStream.ts` (name is yours; one file), with
  `decisionStream(seed, feature, decision, attempt): Rng` built on the
  existing `hashString`/`candidateRng` primitives — **not** a new hash.
  `parkLayout.ts`'s `candidateRng(hashString(entry.id) ^ PARK_SEED, restart
  + bump)` (and #596's `attempts` map) is the same idea done by hand; leave
  it in place this step and note it as the first migration onto the owner
  (stage 5) — do not rewire it here unless every seed's digest stays
  byte-identical, in which case do and say so.
- **Both placers in this pair are deterministic searches that draw nothing**
  (nearest-first marches). So the substream helper is exercised here by the
  *decision log*, not by a random draw: every commit the two tasks make is
  logged as `(feature, decision, attempt)` — `road:outset`,
  `road:spur-end`, `railRace:walk-past-ring:slot-N`, `railRace:race-ring:slot-N`
  — with `attempt` 0 throughout in this step. Say in the PR body, in
  those words, that no random draw goes through the helper yet; a brief
  that implied otherwise was wrong.
- **The trace has one owner already**: #596 lands `layout-trace:` lines
  (`parkLayout.ts` `traceLine`) printed to **stderr** on every build, and
  `scripts/park-digest.mts` gains a `trace` line hashing them. Extend that
  owner — one trace, a `generation-trace:` prefix beside `layout-trace:`, or
  the same function with a stage field — do not add a second trace or a
  second digest line. The scheduler's **task-turn log** (task name, slice,
  yield value, per `advance()`) is what acceptance 4 pastes; it is the same
  trace, one line per turn, and it is deterministic by the fixed round
  order.

### 4. The perturbation experiment, run both ways

The #499 review measured four of six `deps` inert: relaxing them changed
nothing because the ladder gated the tasks. After this step, relaxing the
two migrated tasks' `deps` must **visibly change the turn order** in the
task-turn log. Paste both orders (with deps, without) for one seed. That is
the proof the deps went load-bearing and it is this step's whole point.
The other six tasks' rungs, gates and deps stay exactly as they are.

## What must not change

- Any other placer's gating, order or `deps`. The six unmigrated tasks and
  their ladder rungs are untouched; the header's "ladder-vs-deps honesty
  note" in `parkGeneration.ts` is updated to say which two are now real.
- The failure semantics documented in `parkGeneration.ts` ("Failure
  semantics, preserved exactly": `RailRouteUnsolvable` out of the cruiser,
  the slide's per-rung catch, import failure captured not thrown). Add
  nothing to that list. Under totality those throws are debts, not
  contracts; they are stage 4/5's to retire, not yours to add to.
- No negotiation, no unwind (step 4). A refusal surfacing during
  interleaving follows the existing path (step 2's loud throw naming
  blockers). If any seed hits it on the sphere, stop and report with the
  message — that is step 4's first customer, not a thing to hand-patch.
- The ring (`RAIL_RACE_PLAN`), the road's derived outset, every clearance.

## Byte-for-byte expectation: signed, not discovered

The design says the park *may* change at step 3 because interleaving changes
draw order. **On this pair, expect it not to**: neither placer draws, so the
shared streams the other tasks read are consumed in the same order. What
*can* move a leg is (a) the collision predicate being dropped (measured,
above) and (b) the trestles reading the provisional rather than realised
spur (measured, above). So:

- Per pool seed (the pool on the branch you start from — 0..15 once #584
  lands, the fourteen otherwise): park digest before/after (`scripts/
  park-digest.mts`, which hashes instance matrices since step 2 — run it
  on the base first and confirm it can see a leg move). State per seed
  "identical" or name every changed group and the reason from (a)/(b).
- **The Architect countersigns the per-seed table before review.** If any
  park changes it is visible work: preview link with `/spawn?pos=…` at the
  changed leg, one sentence, Jim's sign-off. If none changes, the PR is
  invisible and merges on QA's measurement (CLAUDE.md).

## Acceptance — measured, quoted off the screen

1. **Perturbation, both ways**: two task-turn logs for one seed, deps on
   and deps relaxed, orders visibly different. Pasted.
2. **Interleaving is real**: the task-turn log for one seed showing
   `railRaceSupports` and `roadCorridor` slices between other tasks'
   slices — not asserted from code shape. If `railRaceSupports` had to
   depend on `roadCorridorRealised`, the log shows what it interleaves with
   and the PR says so.
3. **Determinism**: two builds per pool seed in **separate processes**,
   digests identical including the trace line. Quoted.
4. **Change accounting**: the per-seed digest table, countersigned.
5. **The collision-predicate measurement**: the count per seed, and the
   decision it drove.
6. **Letterbox parity**: letterboxed trestle spots byte-equal to a
   construction-time re-solve on one seed (the assertion in
   `check:ground-claims`), proved red once by perturbing the re-solve
   (e.g. `SEARCH_STEP` 1 → 0.5 in the re-solve only), transcript pasted with
   the differing spot's coordinates.
7. Frame budgets: `check:park-boot` green — the trestle task slices per
   slot; the road's first turn is one slice. Measure, do not reason.
8. Full gates, exit codes read directly: `pnpm run check` (chain parsed,
   step *set* compared with the base), `pnpm run test:procgen` (every
   invariant, every seed — the step most likely to shake something loose),
   `pnpm run build`, `check:coplanar`, `check:swept-bus`, `check:park-pool`.

## Traps, pre-paid

- Eager import ≠ free: one `import()` resolves and compiles its whole
  unseen graph synchronously (70 ms measured for `coaster/solve`). "Eager"
  means *earlier and gated on data*, not "all at frame zero".
- `PATH_GRAPH` and `RAIL_RACE_PLAN` are module constants that take a
  prewarm letterbox or build at load; a static import of either into
  `test/` pins every seed to the canonical park (CLAUDE.md, "A skipped test
  is not a passing test"). Read facts from `ParkFacts`.
- The scheduler throws on two tasks sharing a name; `roadCorridorRealised`
  is a second task, not a second `start()` on the first.
- `rerere` replays stale `check`-chain resolutions; rebuild from the base's
  parsed step list.
- Never build the park twice in one process (the buildGraph-twice trap).

## Definition of done

Trestles are a scheduler task consuming the live registry; the road takes
two real turns; the two tasks interleave (log pasted) and their deps are
load-bearing (perturbation pasted); the decision-stream owner and the
decision log exist, honestly described; determinism proved in two
processes; every park change signed by the Architect or none claimed; all
gates green with exit codes read directly.
