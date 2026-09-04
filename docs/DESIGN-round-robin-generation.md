# Round-robin generation with backtracking

**Design for Jim's ruling, 3 September 2026.** Direction set by Jim directly,
in conversation, same day: *"I really think they should be added all at the
same time, in some kind of round-robin fashion"*; *"round-robin with
backtracking"*; *"it should be deterministic via a PRNG"*; *"a failed seed
ultimately could backtrack all the way back to zero park existing and try the
next values"*; *"if we can backtrack all the way to an empty park no number
can ever fail"*.

This document turns those sentences into a buildable design. It revises, and
should be read alongside, `docs/DESIGN-ground-claims.md` on
`design/ground-claims` — the registry proposed there is kept whole; what
changes is that **round-robin becomes the spine of the plan rather than its
deferred stage 5**.

The sentence to carry if you carry only one: **a computed overview of the
world may inform any number of decisions, but only a claim makes ground
yours.** Every mechanism below is that sentence applied somewhere; every bug
this doc cites is a system somewhere treating an overview — a phase's
output, a feasibility list, its own earlier answer — as a reservation.

---

## Lead with the most damning fact

**This idea has already survived design review twice and died at integration
twice.**

- `CoSolveEngine` (`src/boot/coSolve.ts`) — negotiation-style backtracking
  where a refused placer learns *who* refused it and the blocker can be
  withdrawn and re-placed. Built. Ten unit tests. **Wired into nothing.**
- `PlacementField` (same file) — a shared model of claimed ground. Built.
  Unit tested. **Wired into nothing.**
- Decision 12 ruled the co-solve on **11 August**. Stages 2–4 never started.
- `CLAUDE.md` states, today, as the standing rule: *"every feature generates
  step by step at the same time, not one system finishing before the next
  starts."* The pipeline is strictly sequential. The sentence describes a
  park that has never existed.

**Update, 3 September 2026 — the streak is broken.** Stages 1–2 merged to
`main` as #499: `src/boot/groundClaims.ts` is the live registry (superseding
`PlacementField`, which now carries a dead-registry sign in `coSolve.ts`),
and `parkGeneration.ts`'s driver is one `SolveScheduler`, proved
byte-identical to the old chain. Read the paragraphs above as the history
that made the integration-first plan necessary, not as the present state —
and read `parkGeneration.ts`'s module header for the honest caveat: today
the *import ladder*, not the declared deps, still serialises the order, and
stage 3 is where that gets confronted.

Why it keeps dying: every agent arrives scoped to a ticket — a bridge bug, a
fence bug, a gate bug. Round-robin is a change to the *spine*, not to any
feature, so no single-ticket engineer can deliver it; the rational move inside
one ticket is always another rescue ladder at that ticket's own seam. Six
ladders later (`feat/grid-paths` counted them), the branch that was supposed
to fix paths spent a day and a half bridging seams instead. This week two
agents' individually-correct fixes collided: one lengthened a bridge's claimed
ground — a good fix — and severed the lattice row the front gate needed,
seventeen metres away. Neither could have seen it from inside its ticket.

**Therefore the first deliverable of this plan is the integration, not the
mechanism.** The mechanism exists. The plan below makes the scheduler land
first, with zero behaviour change, so that delivering round-robin becomes N
small per-placer migrations — ticket-sized, the shape of work this fleet can
actually do — instead of one big bang nobody ever starts.

## The disease, restated in one line

Ten separate models of "what is on this ground" — `CollisionWorld`,
`BLOCKERS`, `PARK_LAYOUT`, the lattice, the path graph, the crossing plan,
bridge site reservations, `NavGrid`, `keepOutsFor`, `PlacementField` — none
of them the authority, run in a fixed order where each phase treats the
previous phase's output as immovable fact. Every layout bug of the last two
days is two of the ten disagreeing. Generators check hand-picked obstacle
lists, so their correctness depends on where the dice happen to fall — which
is the *only* reason a "bad seed" has ever existed.

## The contract: the generator is total

**Every integer is a valid seed.** Not "0–15 work", not "the pool is
re-vetted" — *any* number. This is achievable by construction, not by
testing:

1. Every decision the generator makes is a draw from a seeded PRNG stream.
2. Every placement is a **claim** against one shared registry, checked
   against everything already claimed — no placer enumerates obstacle kinds,
   so no placer can miss one.
3. A refused claim backtracks: try the next value, ask the blocker to move,
   or unwind further — **up to and including to an empty park**, where the
   search re-draws with the attempt counter folded into the stream
   (`hash(seed, attempt)`). A restart is just backtrack-to-zero done cheaply.
4. Deterministic throughout: same seed in, same park out, however many
   internal retries occurred.

With those four, no input can fail. The only remaining failure is exhausting
a bounded attempt budget, and that is **a generator bug that gets logged
loudly with the conflict that caused it** — never a hung boot, never invalid
geometry shipped, and never, ever, "a bad seed".

### What totality retires

- **Seed vetting.** The pool exists because vetting tried 515 seeds to keep
  17. Under totality, `parkSeedPool.ts` is deletable; CI can test seeds 0–15
  because sixteen is a convenient number to look at, not because those
  sixteen are special.
- **Seed preservation as a discipline.** "Never cost a seed" and "if anything
  but seed 5 moved, revert" were rational insurance in a world where most
  seeds don't build. That world ends. After this, the *invariants* are
  precious and every seed is disposable — a regression is "invariant X now
  fails on some seed", never "we lost seed 267".
- **The 40% of vetting rejections** measured to be one system standing on
  ground another needed (~100 stranded waypoints, ~96 failed railway loops of
  498 rejections). The other ~60% (quality failures: dull rides, bad camera
  lines) are out of scope here and stay honest — see "What this does not
  fix".

## The mechanism

### One registry, four claim kinds

Unchanged from `DESIGN-ground-claims.md`, adopted whole: **footprint**,
**corridor**, **walkable-must-remain**, **surface**, with a small fixed
compatibility table between kinds instead of per-placer knowledge. (A fifth
kind, **demands**, arrives in the quality tier below — owed things rather
than occupied ground — and the stage-4 mechanism uses it for support
obligations too.) A placer asks "may I put this here?" and never names an
obstacle type. There is **no other way to place anything** — the API is the
only door, because CLAUDE.md's prose version of this rule was read by every
agent who then violated it.

*Built, 3 Sep (#499):* the substrate is `src/boot/groundClaims.ts` — all
four kinds plus demands, `CLAIM_COMPATIBILITY` as exported data (one law
for the generator and the universal invariant), declared crossings gating
corridor×corridor, and `blockers()` in commit order for backjumping. An
earlier draft of this section called `PlacementField` "80% of the
substrate"; it was the model to steal, not the module to keep, and it is
superseded — `coSolve.ts` says so at the definition.

### Round-robin scheduling

`parkGeneration.ts`'s driver stops being a fixed sequence of completed phases
and becomes a scheduler:

- Each placer (paths, railway, bridges/crossings, plots, fences, lamps,
  trees, boundary, rail race, …) is a **coroutine that makes one claim (or
  one small batch) per turn and yields.**
- Turn order within a round is **fixed** — determinism comes from order plus
  the PRNG, never from timing.
- Growth is incremental everywhere at once: the railway has laid some track,
  paths have grown some segments, a bridge has a provisional site — and a
  conflict surfaces **while both parties are still small and cheap to move**,
  instead of when one of them is finished and frozen.
- A bridge stops being bolted onto paths: a crossing is what happens when a
  path claim and the railway's corridor claim want the same ground, and the
  negotiation produces deck, ramps, width and claimed ground **in one
  decision**. (Jim, 2 Sep: *"these need to be considered together from the
  start."*)

### Provisional claims

Kept from the ground-claims memo, and they get *better* under round-robin: a
bridge claims a site provisionally in an early round and realises the claim
with its true stone a few rounds later, when the path that crosses it knows
its width — a gap of rounds, not of the whole rest of generation.
`SITE_HALF_WIDTH` (measured: refuses doors 1.1–2.3 m outside the real stone
*and* leaves the real stone unscreened) goes.

### Backtracking, one mechanism instead of six

A refused claim returns who refused it (`CoSolveEngine`'s `blockers` hint,
already built and tested). The ladder of responses, in order:

1. **Retry**: draw the next value — different position, width, orientation.
2. **Negotiate**: ask the blocker to be withdrawn and re-placed (the
   fountain steps aside for the railway; the felling-foliage precedent
   generalised).
3. **Unwind**: pop earlier decisions and re-draw — **any earlier decision,
   not only the noticing placer's own.** Jim, 3 September 2026, verbatim, on
   the slide-leg case below, given as the specification: *"This is just a
   normal collision to backtrack from. If needs be, the backtracking would
   place the castle somewhere else, which is fine. All decisions can be
   backtracked or reversed."* Nothing is pinned by having been decided
   earlier: if the cheapest way out of a slide leg standing in the train's
   path is to move the castle, moving the castle is a legitimate resolution.
   Negotiation is transitive — a blocker asked to move may itself backtrack
   further — and the backjumping hint is what points the unwind at the right
   decision instead of the chronologically previous one.
4. **Restart**: unwind to the empty park, bump the attempt counter, re-draw
   everything. Legal, deterministic, and expected to be rare.

The six existing ladders (bridge-foot join, gate handover, door arrival,
`relayPolyline` rescue, grid discipline, exemption-by-identity ×3) are scar
tissue from *not* having this; expect most to collapse into the one
mechanism, and be honest that a few encode real per-placer knowledge and will
merely get simpler.

### A feature's own supports are claims: the slide-leg evidence (3 Sep)

Jim asked why a slide leg has to land in the train's path on one of the
pool's parks. It doesn't — no leg is ever built there. What ships instead is
a stretch of unsupported chute, and the mechanism is worth recording because
it is the cleanest specimen yet of the disease this design exists to cure,
in a place none of the ten ground models can see:

- `src/world/slide/solve.ts` picks the chute's route on gradient and length,
  then hands it over as fixed. It knows the rail corridor exists (it keeps
  the *chute* and the *exit* off it) — but it never asks whether the route
  it is committing can be **held up**.
- `src/world/slide/supports.ts`'s `planSlideLegs` fits legs underneath
  afterwards — called from `Building.ts` at scene build, long after the
  route froze. A leg's only freedom is to slide **along** the chute
  (`NUDGES`, ±10 m); it cannot move sideways, because sideways is no longer
  under the chute.
- Today the leg planner's obstacle list does not name the railway at all
  (`isClear`, `distanceToPath`, plots, the castle, the cruiser column — no
  rail corridor), so legs are *placed* in the train's path: issue #501,
  found by the universal overlap invariant's first honest run, measured
  **four legs inside `TRACK_CLEARANCE` on one pool seed**, the deepest with
  its centre 0.12 m from the rail centre line. The train drives through
  them every lap.
- And the ticket-shaped fix — add the railway to the list — does not fix
  the feature; it **trades the loud bug for the quiet one.** Once legs in
  that stretch are refused, their only freedom is along the frozen chute,
  every candidate there fails, and the planner's own comment states the
  policy: *"one that cannot is simply skipped."* The chute goes
  unsupported, and the *generator* refuses nothing — only the downstream
  legs-per-metre invariant says so. A train through a post and a floating
  chute are the two faces of the same committed-too-early route.
- This is not hypothesis: `fix/slide-legs-501` **built the honest ticket
  fix and measured the trade.** Railway violations went 4 → 0 across the
  pool, and seed 5's slide went 8 legs (4 illegal) → **2 legs on an 83 m
  chute**, failing the walk-between-legs invariant. Sampled along that
  chute: 55% of it is forbidden by path clearance, 33% by the railway —
  **5% of the route is supportable ground.** Every within-ticket lever was
  tried and refuted with numbers (more attempts: ceiling of 3 legs at any
  spacing — the constraint is ground, not questions; a greedy walk: worse;
  shaving clearance: ships a post through the lineside fence). The
  engineer's own conclusion names the one real fix — *re-route the chute* —
  and correctly rules it out of the ticket, because in today's pipeline
  that means hand-editing a 3.5 s solve that was never asked whether its
  answer could stand up. Under this design it is not a ticket at all: it is
  the backtrack the route's own leg-claims trigger.

This is #317/#319 again — a generator committing before the thing that
constrains it exists — with one twist that earns it its own section: the
colliding parties are **the same feature**. The route and its legs are one
placer's two halves, and today's shape lets the first half freeze before the
second half has asked its first question.

**Jim's ruling, 3 September 2026, verbatim — this is the specification, and
it stands alongside his unwind ruling above:**

> *"Any collisions caused by a step in the gen should count. The supports
> should be added as and when the section of slide are added, not after
> slide generation. Same applies to all extra geometry associated with a
> feature."*

Three things that settles:

- **Granularity.** Supports are claimed **section by section, as each
  section of chute is laid** — never for a finished route. A section that
  cannot be held up is refused while only that section is committed, not
  after 83 m of route has been decided.
- **Scope.** Not a slide rule: **all extra geometry associated with a
  feature** — trestles, pylons, footings, anything a feature grows to hold
  itself up or dress itself — is claimed with the step that creates the
  need for it.
- **By-products are real.** "Any collisions caused by a step in the gen
  should count" is the ask-the-world rule applied to a feature's own
  by-products: a leg is as real as a wall the moment it exists, and every
  placer downstream — including its own feature's later steps — must see
  it.

Two design consequences, both binding on the migration stages:

- **A feature's derived placements are claims like any other, made
  interleaved with the parent decision, in the parent's own turns.** The
  slide's placer claims a route segment *and the legs that stretch needs*
  as it grows; a leg that cannot claim ground is a refusal that backtracks
  into the route while the route is still cheap to bend — rung 1 re-draws
  the segment, rung 3 unwinds further, and per Jim's ruling above the
  unwind may go as far as moving the castle the slide hangs from. The same
  family: the rail race's trestles, the cruiser's pylons, any elevated
  thing with feet.
- **A silent skip is a refusal with the alarm unplugged.** "A gap in the
  supports is a much smaller problem than a paddock in the middle of the
  park" was the right call *within* a planner that cannot move the route;
  under this design the premise is gone, and the pattern is banned:
  a placement a feature needs either succeeds, or backtracks, or fails the
  build loudly within budget. "Elevated structure is supported" (the
  invariant already wants one leg per 20 m) joins the **hard** list in the
  quality tier below — it is anything-that-looks-solid-must-be-solid's
  sibling: anything that looks held up must be held up.

### Smarter than blind backtracking (Jim: "looking ahead a couple steps — premature optimisation or genuine help?")

This is a constraint-satisfaction search, and CSP practice settled the
question: **cheap propagation and ordering are genuine help; deep lookahead
is the premature optimisation.**

Genuine help, in the order they should arrive:

- **Backjumping** (ships with the spine): a refused claim already learns who
  refused it (`CoSolveEngine`'s `blockers` hint), so failure jumps straight
  back to the blocking decision instead of unwinding unrelated ones
  chronologically. Nearly free — the information already exists.
- **Forward checking** (add on measured thrash): when a claim commits, check
  the domains it just constrained — the doorway with one approach left, the
  rail gap that now fits one bridge site. A domain at zero fails *now*, not
  forty rounds later. One lookup per affected neighbour; no search.
- **Most-constrained-first** (add with forward checking): the scheduler gives
  the next turn to the placer with the fewest legal options — a placer with
  one option is a fact, not a choice; commit it before anyone steals its
  ground. Strict round-robin is the naive fairness; "round-robin, but the
  desperate go first" is the real rule. Deterministic, because domain sizes
  are computed from a deterministic world.
- **Least-constraining-value**: among legal options, prefer the one that
  removes fewest options from others.

Premature optimisation: **simulating k moves down alternative futures.**
Exponential in k, and it duplicates what backtracking already is — lookahead
paid for lazily, only on paths actually taken. No planner.

Rollout rule, per this repo's measure-first culture: the spine ships with
plain backtracking + backjumping (simplest correct thing; totality holds
regardless). Propagation and ordering change **no outcomes, only search
speed**, so they are pulled in by a measured retry-thrash number, not built
speculatively — and the budget counters above are exactly the instrument that
will show when.

### Determinism rules (non-negotiable)

- **Named per-placer PRNG substreams**, derived as `hash(seed, placerName,
  attempt)` — so one placer drawing more numbers can never shift another
  placer's stream. A shared linear stream would make every behaviour change a
  whole-park change.
- **Fixed round order.** No timing, no map-iteration order, no
  `Promise.race`.
- **Bounded budgets**: max claims-per-turn, max conflicts-per-attempt, max
  attempts-per-seed. Exhaustion throws with the full conflict trace. A park
  that cannot settle is a bug report, not a slow boot.

## The plan, re-cut

Judged at every stage by `test/procgen/invariants.ts` (~80 invariants) and
`check:park` — the invariants are the one asset of `feat/grid-paths` that
must survive anything.

### Stage 1 — the registry, validated by the tests ✅ landed in #499

Planned as: widen `PlacementField` to the four claim kinds and make
`test/procgen/parkFacts.ts` readable from it. **Shipped as**: a new module,
`src/boot/groundClaims.ts` (see "One registry" above), with 17 unit tests —
building fresh beside the superseded field proved cheaper than widening it.
The parkFacts-readable-from-the-registry proof deferred to the migrations
themselves: each placer that migrates is proven by the universal invariant
reading the built park, which is the stronger form of the same check. No
park changes; proven byte-identical.

### Stage 2 — the scheduler lands, byte-identical ✅ landed in #499 (**the un-skippable one**)

`parkGeneration.ts`'s driver is one `SolveScheduler` where **an un-migrated
placer runs whole in its slot** — one giant turn, exactly the old behaviour.
Proved byte-identical by `check:park-boot`'s sliced-vs-straight-through
hashes (slide route, chute, cruiser loop, plus five more in the #499 review:
train plan, crossing sites, level crossings, path graph, stations). This was
the stage that had never been attempted and the reason the idea died twice;
now that it is on `main`, round-robin is no longer a rewrite anybody has to
start — it is a migration checklist. The honest caveat travels in the module
header: the import ladder still serialises the order until stage 3 confronts
it.

### Stage 3 — first negotiated pair (small; measurable)

Migrate the entrance road + rail-race trestles pair (issue #488 — worst
intrusion 2.51 m, a fix already in flight on `fix/road-487-488` to compare
against). The road claims a corridor; the trestle search asks the registry.
The cat-bus class of bug — asking a world that does not exist yet — becomes
unconstructible, because during round-robin there is no "yet".

**Decision point, as in the original memo:** if this does not clearly beat
the hand-written fix, stop; the cost was ~two invisible weeks and the tests
gained a registry.

#### Stage 3, specified (3 Sep, after the spine landed as #499)

**Where the pair's decisions are made today**, established by reading the
merged code — the spec starts here because a migration that misidentifies
the commit points migrates nothing:

- `RAIL_RACE_PLAN` solves at **module load** of `railRace/plan` — an
  *ungated* rung of `parkGeneration.ts`'s import ladder. The trestle legs
  are then chosen even later, at `RailRace` **construction** in `World.ts`
  (`buildRailRaceTrack`; the walk-past ring registers collision first and
  the race ring's search sees those posts — negotiation by construction
  order, working today, undocumented as such).
- The road's route lives in `entrance/roadRoute.ts` (as of PR #498), and
  the trestle search in `railRace/track.ts` avoids it via a **named road
  corridor clause** — the hand fix is itself the two-definitions seam this
  stage removes: the trestles name the road, the road names nothing, and
  the next thing to arrive near either names neither.

**The migration, in order — each step a small PR. Byte-identical through
step 2; the park may first change at step 3** (an earlier draft said
"until the last", contradicting the determinism note below — the note is
right: interleaving changes draw order). Each step's brief states its
byte-for-byte expectation and how it is proved:

1. **The road becomes a placer.** Its route computation moves out of
   module-load/scene-construction into a scheduler task that publishes a
   **corridor claim** to `GroundClaims`, with the built road consuming the
   claimed centreline (one owner — the claim *is* the route, never a claim
   copied from a route). The prewarm-letterbox pattern the cruiser, train
   and slide already use is the template.
2. **The trestles become a placer.** Each leg is a **footprint claim**
   asked of the registry — the named road clause and the
   construction-order collision trick both dissolve into "may I stand
   here?". A refused leg retries along its ring (the search's existing
   freedom), then backjumps via `blockers()`. *Staging note:* at this step
   the legs still hang off a finished `RAIL_RACE_PLAN` — an interim state.
   Jim's section-by-section ruling (above) is the end state: the ring's
   sections and their legs claim together when the ring itself migrates to
   incremental growth in stage 4/5. Step 2 buys the registry and the
   deleted pairing now; it does not discharge the ruling.
3. **Confront the ladder** — the step that makes it round-robin rather
   than a refactor. The two migrated placers' modules load **eagerly (or
   behind data-readiness gates), not behind task-completion gates**, so
   their tasks' `ready()` answers true while other tasks still run and the
   scheduler genuinely interleaves them. At that point their `deps` and
   claims become the real constraints; re-run the perturbation experiment
   from the #499 review (relax a dep, watch the order change) to prove the
   deps are now load-bearing — the four-of-six-inert measurement is the
   "before" of that proof.
4. **Negotiation, only now**: where road corridor and trestle footprint
   want the same ground, the refusal path runs — trestle steps aside
   first (cheap, many candidates); if no leg placement serves the ring,
   the road's corridor re-draws. This is the first real backtrack across
   a feature boundary, and its budget counters are the design's first
   thrash measurement.

**Determinism note:** stage 2's byte-identical guarantee ends at step 3 by
design — interleaving changes draw order. Named per-placer substreams
(`hash(seed, placerName, attempt)`) must land **with** step 3, not after
it, or every later change to either placer reshuffles the whole park.

**Acceptance, all measured on the built park:**

- The universal invariant's road×trestle pairing green across the whole
  pool with the named clause **deleted** from `track.ts`.
- `check:entrance-road`'s swept-bus control (151 legs across 16 seeds in
  PR #498's version) stays armed and green — it becomes the independent
  instrument that the registry is not marking its own homework.
- Beats the hand fix on the stated stakes: same or better clearances, no
  named pairing left between the two placers, and the next feature placed
  near either is covered with zero new code — which is the property the
  hand fix structurally cannot have.

**Sequencing against `fix/road-487-488`:** let it land first (it fixes a
player-visible bug now, and its instruments are the acceptance harness
above); the migration then *removes* its named clause and keeps its
checks. Do not race it.

### Stage 4 mechanism — incremental route growth: explore free, commit in sections

Jim's section-by-section ruling (the slide-leg section above) reshapes how
every route-solving feature — slide, rail race, train, cruiser, all built on
`rail/generate.ts`'s shared `railRouteSearch` — migrates. Today that search
explores an (attempts × segment-choices) space **privately**, with its own
backtrack counters, and only a finished `SolvedRailRoute` ever leaves it.
Naively claiming every explored segment would thrash the registry across
thousands of speculative branches that were never going to be built. The
reconciliation is one distinction:

- **Exploration is free and private.** A search may *read* the registry as
  much as it likes — "would a section here be refused?", "could a leg stand
  under it?" — reads cost nothing and claim nothing. All of today's search
  cleverness survives unchanged inside the placer's own turn.
- **Commitment is turn-based and sectional.** A placer's turn commits **one
  section**: the segment's corridor/footprint claim *plus the extra geometry
  that section needs* (Jim's ruling — legs, footings, trestles, claimed with
  the step that creates the need). The section is the unit of unwind: a
  placer's own backtrack pops sections LIFO and their claims with them;
  cross-placer backjumping pops other placers' sections per the unwind
  ruling above.

Support obligations get the **demand** mechanism, which turns out not to be
paths-to-doors-specific: a committed elevated section publishes a demand
over its arc interval — *"held up within the invariant's spacing"* — and leg
footprint claims serve it. This is what makes the ±10 m nudge legal and
principled at once: a leg may stand in a neighbouring section and still
serve the demand, but a demand no leg can serve is a refusal **at that
section**, arriving while the route is bendable, not after 83 m has frozen.
An unserved support demand and an unserved door demand are now the same
object failing the same way.

Two honesty notes, both measurable when this lands:

- **Search behaviour may legitimately change.** A route "found" by
  exploration can still die at commit if a sibling claimed ground between
  the placer's turns — that is the design working, not a regression; the
  budget counters are the instrument that says whether it happens at a
  tolerable rate.
- **The read API must be the claim API.** Exploration answering "yes" and
  commit answering "no" for the same geometry is the two-definitions
  disease inside one mechanism; the query a search asks during exploration
  and the check a claim runs at commit must be the same function, so the
  only legal source of disagreement is a sibling's intervening claim.

The first customer is **the slide** — ruled by the Overseer (3 Sep): the
re-route that `fix/slide-legs-501` proved necessary and could not deliver
within its ticket *is* this migration; no bespoke `slide/solve.ts` ladder,
and no engineer on it until this stage lands. The rail race ring, train
loop and cruiser follow the same shape through the shared generator.

#### What a section is — the size is derived, never typed

A section is **one decision of the search that grows the feature** — for
everything on the shared generator, one segment of `rail/segments.ts`'s
`turnVocabulary`, the unit `railRouteSearch` already chooses, rejects and
backtracks over. No new constant: introducing a `SECTION_LENGTH` beside a
vocabulary that already has lengths would be a number *typed* where it
should be *derived* — the bug class both of tonight's real bugs were, with
a green check on top, and it would drift from the vocabulary the first
time someone tunes a segment.

The reasons are load-bearing, not aesthetic:

- **A claim must be unwindable to the decision that caused it.** A claim
  spanning several decisions cannot be popped back to the one a blocker
  names — backjumping lands *between* its own decisions. A claim smaller
  than a decision is a claim nothing can re-draw, because there is no
  smaller choice to make differently.
- **Turn cost stays bounded by construction.** A segment is the unit the
  search already prices; the scheduler's millisecond budget (`8 ms`
  slices) already amortises whatever a segment costs. Sizing sections in
  metres or milliseconds would put a second owner beside both.

Batching: the spine's "one claim or one small batch per turn" survives for
**scatter placers** (lamps, trees, bushes — independent placements with no
route to unwind), where a batch is just several one-decision claims that
happen to share a turn. Route placers commit one segment per turn, full
stop. If thrash counters ever argue for coarser route commits, that is a
measured proposal to bring back here — not a knob a migration PR turns.

#### crossingSites: the march becomes exploration, its sites stop being facts

Today `crossingSitesSearch` (~300 ms) marches the railway before paths
exist, proves where a bridge can fit, and offers the sites through a
prewarm letterbox that `paths.ts` then treats as immovable fact — the
committed-too-early shape, one layer up: not a placement but a *list of
possible placements*, frozen before the things it constrains exist.

Under the explore/commit split it is neither deleted nor kept as an
authority — it is **reclassified as exploration**:

- The march survives as a solver: a batch of registry *reads* computing
  "where could a bridge provably fit, given claims so far". Boot-slicing
  through the prewarm letterbox survives with it (the march is still
  ~300 ms nobody wants in one frame).
- Its output is **candidates, not reservations**. Nothing is claimed when
  the march runs. When a path corridor and the railway corridor actually
  conflict, the negotiation consults the candidate list and the chosen
  site is claimed *then* — provisionally, realised when the crossing's
  true width is known (the provisional-claims mechanism, unchanged).
- **Staleness is handled by the one-function rule, not by invalidation.**
  Each candidate is the march's per-site feasibility check saying yes —
  and that check must be *the same function* the bridge claim runs at
  commit. Then a candidate gone stale (a sibling claimed its ground after
  the march) is caught by the commit refusal, exactly like any other
  explore-yes/commit-no disagreement, and the negotiation moves to the
  next candidate or re-runs the march. A cache-invalidation protocol
  would be a second definition of freshness beside the registry's own.

The general rule this instance sets, for every derived artefact of the old
pipeline (`BLOCKERS`, the lattice, feasibility fields): **a computed
overview of the world may inform any number of decisions, but only a claim
makes ground yours** — an overview is exploration however expensive it was
to compute, and treating one as a reservation is the disease in its
subtlest costume.

### Stage 4 — paths, railway, crossings migrate together (large; parks change)

The heart of Jim's brief. Path growth, railway corridor and crossing
negotiation interleave; bridges are born from path×rail conflicts with
provisional-then-realised claims; `SITE_HALF_WIDTH` and the six ladders come
out as their functions are absorbed. `feat/grid-paths` is the reference for
every trap here — its handoff's refuted-hypotheses table is the map of where
the bodies are buried, and its grid invariants transfer unchanged.

### Stage 5 — everything else migrates; totality declared (parallelisable)

Plots, fences, lamps, trees, boundary, scenery: one placer per ticket, now
genuinely parallelisable because the spine exists and each migration touches
one placer plus the shared table. When the last private obstacle list is
gone: delete `parkSeedPool.ts`, switch CI to seeds 0–15 **plus a rolling
random-seed sweep** (new seeds every night — totality means never being
attached to any of them), and add the one new meta-invariant: *any seed
builds within budget*.

#### The migration checklist (3 Sep) — every private obstacle list, named

Compiled by sweeping `src/world` for placement-time obstacle queries
(`isOnPath`, `distanceToPath`, `clearOfCruiser`, `distanceToRailCorridor`,
`isClearCircle`, `insideCastle`, hand-rolled `boundingRadius +` plot
arithmetic). Each row is one ticket; a ticket's definition of done is
**the private list deleted, claims published, and the universal invariant
green pool-wide for that placer** — plus, per the two-definitions variant
below, the claim describing the *drawn* geometry.

Not stage 5 (listed so nobody re-files them here): paths/railway/crossings
and every shared-generator route (slide, rail race ring, train, cruiser)
are **stage 4**; the entrance road and rail-race trestles are **stage 3**.

| placer | module(s) | what it privately names today | claims when migrated |
|---|---|---|---|
| slide legs | `slide/supports.ts` | castle, cruiser column, `isClear`, paths, plots — **not the railway** (#501, ruled: fixed by the slide's stage-4 migration, not a ticket here) | footprint per leg, serving the chute's support demands |
| flowers | `Flowers.ts` | paths + cruiser **only** (#503 — misses walls, rail, everything else; "the same disease one step smaller") | footprint per clump (or per scatter batch) |
| bushes | `Scenery.ts` | asks the world since #500 — the transitional pattern, better than a list, still not claims; **and publishes a 0.85 m footprint for a 2.15 m drawn reach (#504)** | footprint at `BUSH_REACH` for overlap; collider stays 0.85 m (see the variant note below) |
| trees | `Scenery.ts` / `treeModel.ts` | plantability + hand-picked clearances | footprint; **movable** — the felling precedent becomes rung-2 negotiation |
| lamp posts | `LampPosts.ts` | paths + hand-picked clearances | footprint per post + serving the "every path lit" demand |
| plots | `parkLayout.ts` | `PARK_LAYOUT` circles, re-derived by hand in every consumer (`boundingRadius + x` arithmetic in slide, flowers, coaster…) | footprint per plot; consumers stop doing plot arithmetic at all |
| garden walls | `Garden.ts` / `Scenery.ts` | paths, plots | corridor-like footprint runs with declared gateways |
| lineside fence | `train/fence.ts` | derived from the railway after the fact | by-product claims laid **with** the railway's sections (Jim's extra-geometry ruling) |
| boundary + gate | `boundary.ts` / `entrance/*` | its own spline; the gate opening owns `isInEntranceGateOpening` | footprint ring + walkable-must-remain at the opening |
| attached decorations | `FairyLights.ts`, `TreeLights.ts`, `Fireflies.ts` | none — they dress an owner's geometry | probably **exempt** (no ground of their own); each ticket's first job is to verify that and write it down, not assume it |

**The #504 variant, binding on every row:** a private obstacle list is one
face of the disease; **a claim that understates the drawn geometry is the
other**, and it survives migration if nobody looks. A bush that claims
0.85 m of a 2.15 m drawn clump has migrated its collider, not its
footprint — the universal invariant reads the built park and will still
miss nothing *only if* the claim kinds let it: the **footprint claim
describes what is drawn** (one owner — `BUSH_REACH`, not a copy), while
the runtime collider stays its own size for walkability. Reconciling by
widening the collider is explicitly refused in #504: solidity and overlap
are different questions, and the claim kinds exist so they can differ
without lying.

**Order within stage 5**: plots first (every other row's private arithmetic
names them, so their claims unblock the most deletions), then the scatter
placers (flowers, bushes, trees — cheap, independent, and #503/#504 are
already filed), then walls/fence/boundary. The attached decorations go
last and are expected to be verifications, not migrations.

### Fleet discipline

The `feat/grid-paths` handoff's warning, adopted as a rule of this plan: *"a
rewrite handed to a fleet becomes the same object again — parallel agents on
shared ground manufacture exactly these seams."* Stages 1–4 are held by **one
design-owning agent**; parallelism begins at stage 5, where the spine makes
collisions structural rather than accidental.

## The quality tier (Jim, same conversation: "let's talk about the improvements we also need")

Everything above raises the floor — no invalid parks. Jim's brief was never
only about validity, and the parts of it that keep not happening ("the path
still doesn't go up to the hotel") fail for a structural reason: **today,
destinations are decorations, not demands.** The pipeline grows a network and
then asks afterwards whether it happened to reach the doors. The door is not
an input to the path search; it is a thing the search is graded on later —
which is why the paths branch grew arrival ladders and rescue walks trying to
drag a finished network the last seven metres to a door it never knew it owed.

### Demands: the fifth claim kind

When a feature places itself, it publishes what it is owed: *"a paved
corridor must terminate here, flush with this threshold, at this width."*
(This section introduces demands through the quality tier because that is
where Jim's brief raised them, but the mechanism is not quality-only: the
stage-4 mechanism above uses the same object for **support obligations** —
"held up within the invariant's spacing" — which are validity, and #499
shipped demands in `groundClaims.ts` with `unservedDemands()` accordingly.
One mechanism, two tiers of consequence.)
The park is **not finished until every demand is served.** An unserved demand
is a conflict exactly like an overlap and backtracks the same way — reroute
the path; if no path can serve it, the *building* is asked to move or turn.
"Paths reach the hotel" stops being a hope and becomes part of the definition
of done. The universal invariant gets a twin: **every demand served,
deny-by-default** — no hand-picked list of which buildings deserve paths.

"All the way up" defined precisely, because near-misses are the recorded
common failure (doormats stranded 0.3 m from their own paving): **the paving
polygon abuts the threshold.** Zero gap, full door width, roughly
perpendicular over the final approach — never a ribbon that ends nearby or a
diagonal sliver clipping a doormat's corner.

### Seed paths: the door plants its own stub (Jim's construction)

Jim, same conversation: *"a path has to hit the hotel door, and the castle
door, perpendicular to the doors — this should be a seed path that other
paths grow from, and if it fails the backtracking can go so far as to move
the building."*

This moves the correctness from **arrival to departure**, and it is the
better construction. Rather than a network grown elsewhere having to achieve
a flush perpendicular landing on a door — the hard, ill-conditioned version
that all six arrival ladders were scar tissue from — **the building plants
its own door path as part of placing itself**: a short paved stub,
perpendicular off the threshold, full door width, claimed *atomically with
the building in the same turn*. The stub cannot be wrong, because the thing
that knows where the door is drew it. The demand moves to the stub's **free
end** — "the network must join here" — and joining path to path mid-park is
the easy problem.

Three properties fall out:

- **Earliest possible failure.** No room for the stub — the door faces a
  wall, the rail corridor, another claim — and the *building placement
  itself* is refused in its own turn, re-drawing position or orientation
  immediately. Nobody discovers forty rounds later that the hotel opens onto
  a fence.
- **Doors are founding members of the network, not remote targets.** Under
  round-robin the stubs exist early, so paths grow *from* doors as much as
  *toward* them.
- **The full backtrack ladder, in order:** route the network to the stub →
  extend or bend the stub beyond its perpendicular first metres → reorient
  the building → **move the building** → unwind further. Totality holds at
  every rung.

Deny-by-default applies: castle, hotel, every ride entrance, stall front and
seat gets a stub and a demand — there is no list of which buildings deserve
paths.

### Paths do not clump or overlap — and there is no self-exemption

Jim: *"paths should not clump together or overlap — this is an invariant that
gets violated a lot but should backtrack out."*

Clumping survives today because both offenders are the same placer: the path
system checks its ribbons against everyone else's obstacles, and two of its
own ribbons a metre apart is nobody's collision. So, the rule: **every
corridor segment is a claim like any other, including against its own
placer's segments.** A corridor near another corridor is legal in exactly two
ways — a declared junction, or the same shared segment. There is no third
state where two ribbons run parallel a stride apart. Each corridor claim
carries a separation halo; a route wanting ground inside another ribbon's
halo must **join it, reuse it, or backtrack**. Reuse is the move that fixes
the aesthetics: paths clump because drawing a fresh ribbon was cheaper than
routing along the one that existed. Make reuse free and duplication a
refusal, and the network converges to trunk-and-branch — which also serves
the grid ask. The bridge-foot apron knot is this rule at a junction: N
ribbons meet a foot only as one merged junction geometry, never as N
individually-drawn arrivals.

### Bridges may bend (Jim: "by about 10%, by deforming the mesh along its length")

A bridge's spine may curve, with lateral deviation bounded at ~10% of its
span, by deforming the mesh along its length. This is not cosmetic — it is
**one more degree of freedom in the crossing negotiation**: a foot lands
where the network actually is, a claim near an abutment is cleared by easing
the spine rather than abandoning the site, and a deck meets a gently curved
corridor without a kink at its edge. Three rules keep it from becoming a bug
source:

- **The bend is a parameter of the claim.** What is published to the registry
  is the deformed footprint and surface — never the straight ideal with a
  bend applied afterwards (that would be `SITE_HALF_WIDTH` again: claimed
  shape and built shape disagreeing).
- **One spine owns everything.** Mesh, collider, walkable surface and claim
  all derive from the same deformed centreline. A collider following the
  straight original under a bent mesh is the walk-through-the-parapet bug
  built on purpose.
- **The deformation is a sweep, not a stretch.** Authored cross-sections
  (the Blender stone kit) swept along the curved spine, so courses and
  parapets still read as stonework per ART_DIRECTION.

### Hard demands vs soft costs

The tier decides what **backtracks** versus what merely **steers**. Promote
too much to hard and generation thrashes; leave too much soft and the park is
technically valid and visually nonsense.

- **Hard** (a violation backtracks out, on any seed, by construction): every
  door / ride entrance / seat served flush; no corridor clumping or
  self-overlap; junctions merged, never aprons; zero level crossings (kept
  from the parent work); nothing overlaps a walkable-must-remain; **elevated
  structure is supported** — a chute, track or deck whose feet cannot all
  claim ground is a refused placement, never a thing shipped with gaps in
  its legs (the slide-leg evidence above).
- **Soft** (search costs, bounded by invariants): approximate grid layout, no
  pointless mini-turns or twists; things roughly evenly spaced around the
  park; sensible detour ratios — the existing detour invariant graduates
  from bug-detector to quality bar.

The soft list is open — main routes visibly wider than side paths, plazas
where trunks meet, path-to-green ratio are candidates awaiting Jim's ruling —
and each addition is a cost function plus an invariant, never a new private
rule inside one placer.

## The universal collision invariant (Jim, same conversation: "any collision between drawn features, not just certain pairings")

The test suite has the same disease as the generators. Most of the ~80
invariants are hand-picked pairings — `treesKeepOffWalls`,
`lampsTouchNothing`, `plotsDoNotOverlap` — so **a pairing nobody thought to
write is a collision nobody can detect.** The fence through a path was
invisible for exactly this reason: no one had written `fencesKeepOffPaths`.

So, one new invariant, **deny-by-default**:

- Enumerate **everything drawn** in the built park and sweep every feature
  against every other (a broadphase grid keeps this cheap at park scale).
- The **only** thing that may excuse an overlap is the same small legality
  table the registry uses — a path may cross a surface, corridors cross at
  declared crossings, nothing overlaps a walkable-must-remain. One table,
  shared between the generator and the check, so the two cannot drift.
- An unanticipated pairing **fails by default** instead of passing silently.
  New feature kinds are covered the day they exist, with no new test written.

Two rules that keep it honest:

- **It measures the built geometry, never the claims.** The registry checking
  its own claims would be the registry marking its own homework; this
  invariant exists to catch what a generator or the registry itself got
  wrong, so it reads the park the way `ParkFacts` does — real placements,
  real footprints.
- **Its first run is expected to be red, and that is the deliverable.** It
  will find collisions nobody has an issue number for — the unknown
  remainder of the 24-issue backlog, turned into a list. Per the zero-
  tolerance rule those findings get triaged and fixed, not exempted; every
  entry added to the legality table is a design decision to record, never a
  silencer.

**Which invariants generalise (Jim: "maybe in many cases — some not"):** the
**overlap class** — every "X keeps off Y" pairing — is subsumed by the
universal check, because they are all the same fact about ground. The
**metric and reachability classes are not, and must not be**: detour ratios,
lattice discipline, every-path-lit, every-doormat-usable are statements about
quality and connectivity that no collision sweep can see, and "generalising"
one of those away would be the forbidden weakening of an assertion. The suite
ends up as: one universal ground check, plus the irreducibly specific quality
checks, plus the old pairwise rows kept as the control group.

Sequencing: this does **not** wait for the registry. It is buildable today on
`ParkFacts`, it immediately widens coverage from named pairings to everything,
and it then serves as the acceptance test for every migration stage — the
universal check is how a placer proves it stopped colliding, and the existing
pairwise invariants stay on as the control group that proves the universal
check can see what they see.

## What this does not fix

Carried from the ground-claims memo, still true, stated so the design is not
believed to fix everything:

- **Niceness.** The registry raises the floor (no invalid parks), not the
  ceiling (no boring ones). Nothing here knows the ice cream is a dull walk
  from the gate.
- **The vertical.** Plan-view search stays plan-view. #210 and #412 are
  height bugs and remain separate work.
- **Runtime.** `CollisionWorld` and `NavGrid` are untouched; a prop shipped
  without a collider is still a prop without a collider.
- **The ~60% of quality rejections** that were never ground conflicts. Some
  may become backtrackable later (a dull duck bar re-drawn); not promised
  here.
- **The invariants stay. All of them.** The ~dozen the registry makes true by
  construction stay in the suite as the check on the registry itself.

## Relationship to open work

- `design/ground-claims` — superseded in plan-shape (stage 5 → spine), kept
  in substance (registry, claim kinds, provisional claims, the measured
  numbers). Its author's stage risk-notes remain accurate per stage.
- `feat/grid-paths` — frozen by Jim's ruling. Its keepable assets: the
  invariant suite additions, the probes' findings, zero level crossings, and
  the refuted-hypotheses ledger. Its ladders are what stage 4 exists to make
  unnecessary. Whether any of its code merges first is Jim's/the Overseer's
  call and nothing here depends on it.
- `fix/road-487-488` — the measuring stick for stage 3; let it land, then
  beat it.
