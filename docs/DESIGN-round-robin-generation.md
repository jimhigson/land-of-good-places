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
compatibility table between kinds instead of per-placer knowledge.
`PlacementField` is 80% of the substrate. A placer asks "may I put this
here?" and never names an obstacle type. There is **no other way to place
anything** — the API is the only door, because CLAUDE.md's prose version of
this rule was read by every agent who then violated it.

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
3. **Unwind**: pop own earlier decisions and re-draw.
4. **Restart**: unwind to the empty park, bump the attempt counter, re-draw
   everything. Legal, deterministic, and expected to be rare.

The six existing ladders (bridge-foot join, gate handover, door arrival,
`relayPolyline` rescue, grid discipline, exemption-by-identity ×3) are scar
tissue from *not* having this; expect most to collapse into the one
mechanism, and be honest that a few encode real per-placer knowledge and will
merely get simpler.

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

### Stage 1 — the registry, validated by the tests (small; invisible)

As in the ground-claims memo: widen `PlacementField` to the four claim kinds
and make `test/procgen/parkFacts.ts` (56 fields, 2,636 lines of hand-extracted
"what is in this park") readable from it. If the registry can feed the
existing invariants unchanged, it is complete enough to believe. No park
changes.

### Stage 2 — the scheduler lands, byte-identical (small; invisible; **the un-skippable one**)

Convert `parkGeneration.ts`'s driver to the round-robin scheduler where **an
un-migrated placer runs whole in its slot** — one giant turn, exactly today's
behaviour. The park is byte-identical on day one (prove it: same seed, same
serialized world, hashed). This is the stage that has never been attempted
and the reason the idea has died twice: after it lands, round-robin is no
longer a rewrite anybody has to start — it is a migration checklist.

### Stage 3 — first negotiated pair (small; measurable)

Migrate the entrance road + rail-race trestles pair (issue #488 — worst
intrusion 2.51 m, a fix already in flight on `fix/road-487-488` to compare
against). The road claims a corridor; the trestle search asks the registry.
The cat-bus class of bug — asking a world that does not exist yet — becomes
unconstructible, because during round-robin there is no "yet".

**Decision point, as in the original memo:** if this does not clearly beat
the hand-written fix, stop; the cost was ~two invisible weeks and the tests
gained a registry.

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

### Fleet discipline

The `feat/grid-paths` handoff's warning, adopted as a rule of this plan: *"a
rewrite handed to a fleet becomes the same object again — parallel agents on
shared ground manufacture exactly these seams."* Stages 1–4 are held by **one
design-owning agent**; parallelism begins at stage 5, where the spine makes
collisions structural rather than accidental.

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
