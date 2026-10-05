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

### Totality, ruled and mechanised (Jim, 6 Sep)

Asked whether to curate which seeds a new profile draws — on today's
generator only **2 of seeds 0–15** build a working park — Jim refused the
question: *"given we can backtrack back to zero, there's no reason this
should happen if things are implemented correctly since the backtrack to
zero is equivalent to trying another seed — fix it properly."* So the four
points above are a **requirement**, and the seed pool is at most a quality
curation, never a buildability filter: retiring a seed hides an instance
and changes nothing. The mechanism, concretely:

**Every decision is numbered and every failure is a refusal.** The
round-robin's turn log is a sequence of decisions
`(feature, decisionName, attempt)`, each drawn from
`hash(seed, feature, decisionName, attempt)`. A generator **never throws
on a placement it cannot make**; it returns a *refusal* to the scheduler
naming what blocked it — either blockers (claims, from the registry's
`blockers()`) or, for a search that fails against its own inputs, the
*decisions it consumed* (its `deps`' latest decisions). A throw is
reserved for programming errors and exhausted budgets; a throw on a
seed's geometry is the bug.

**Unwind order — the ladder, from the section below, with its last rung
now named:**

1. **retry** — the refused decision draws its next attempt (same
   feature, `attempt + 1`);
2. **negotiate** — the most recently committed blocker is asked to move
   (its own next attempt), the refused decision retried;
3. **unwind** — backjump to the **most recent decision among the
   blockers** (or among the consumed inputs), withdraw everything
   committed after it, redraw it, replay forward. Repeat, each time one
   decision further back, until the refusal clears;
4. **decision zero** — the layout's first draw. Redrawing it with
   `layoutAttempt + 1` is a different park from the same seed —
   *equivalent to another seed*, which is exactly Jim's point, and it is
   what `parkWarp.ts`'s `layoutRestart` does by hand today. Reaching it
   is legal and *counted*, never silent.

Budgets are per rung and derived from the search (attempts a decision
has; number of decisions to unwind through), never a typed "try 5
times"; exhausting the budget at decision zero is the one remaining
failure, logged with the whole refusal chain, and it is a generator bug.

**The three terminal failures today, mapped onto the ladder** (seeds
0–15, 6 Sep):

- **`RailRouteUnsolvable`** (seeds 0, 8, 9, 10): the rail search fails
  against layout plots, boundary and terrain. Its refusal names the plot
  placements its search collided with (the search knows its obstacles;
  naming them is the change). Unwind: the most recent of those plots
  redraws (its own `layout` stream, next attempt — `parkWarp`'s `layout`
  bump made automatic and general) → rail retries → … → decision zero.
- **A crossing with no proven site** (seeds 2, 3, 7): the recovery
  contract in "Seed 288, root-caused" — demand a site at the drawn `d`,
  else re-route that route — and, when both fail, its refusal names the
  **train route decision** (the sites are a function of it): unwind
  re-solves the train route at its next attempt → stations move → sites
  move → paths re-solve. `banCrossingsAt` made automatic.
- **`poi.stranded` / `poi.nospot`** (seeds 1, 4, 5, 6, 13, 15; and 346
  in the old pool) — **the class that matters most, because it survives
  the old generator: it is on `main`'s own ground.** A stranded POI is an
  **unserved demand** (the fifth claim kind: "a door served flush by a
  corridor"), and an unserved demand fails the paths' commit *by name*.
  Its blockers are whatever stands between the POI and the network —
  from the registry, `blockers()` on a corridor probe from the POI to the
  nearest path; before the registry, the path solver's own obstacle hits
  on that probe. Unwind: the most recent of those (a plot, a wall, a
  railway section) redraws; if the blocker is the POI's *own* plot (no
  spot: `poi.nospot`), that plot redraws first. **Interim rung,
  implementable on today's code without the registry**: the stranded
  POI's own layout entry redraws at its next attempt and paths re-solve —
  the warp's per-entry `layout` bump, automatic — then the entries it
  collided with, then decision zero. That is the rung to build first;
  it discharges six of sixteen seeds' failure class on `main`'s ground.

**The POI class, measured before a line was written (6 Sep) — and the
ruling it forced.** The POI engineer probed every stranded node on seeds
1, 4, 6, 13, 15 and unwarped 5 with the **player's own router** (NavGrid,
from the entrance): **100 % reachable on every seed** (83/83, 63/63,
13/13, 12/12, 3/3, 10/10). `check:park`'s "19/19 attractions route" had
been saying so beside a `poi.stranded` count. What cuts each pocket is
`PoiGraph`'s edge rule — a straight chord, same lane only, 0.7 m off-path
clearance, 13 m max — refusing walks the lattice makes: bridge parapets
and the lineside fence at rail distance 3–11 m (seeds 4, 13, 15, 5), a
booth's own wall (6), walls inside the water-fight footprint reached
through `computeStreetStubs`' 7 m arrival exemption plus two bushes (1).
Every one of those paths was drawn by the router believing it connects.

So the brief's rung 1 would have fired on **zero** of six seeds, and a
layout redraw would have been *moving rides to placate a measurement* —
the disease, not the cure. But the measurement is not lying either:
`PoiGraph` is what **the children walk** (`wanderDriver.ts`), and NavGrid's
own header keeps the two graphs apart on purpose (a waypoint is a
destination; a lattice cell is a patch of floor). `poi.stranded` truthfully
says *no child will ever walk to that ride*. That is a real defect of a
different kind: **the NPC graph cannot walk what the router drew.**

**Ruling (Architect, 6 Sep) — superseded the same day; kept for the
record of the error.** The first ruling said "reachable has one owner:
the drawn path network — `PoiGraph`'s edges follow the drawn route." Its
premise — that the children walk `PoiGraph`'s edges — was inferred from
an import list and is false: `wanderDriver.ts`'s header (#350) records
the random walk over the graph **deleted**, `Journey` is the one owner of
where a child is headed and routes every leg on **the player's own
NavGrid** (`JourneyPlanner`, one NavGrid per space), and `neighbours` has
no consumer outside `poiGraph.ts`. The edges exist only to compute
`reachable`, which gates `spawnNodes()` / `nearest()`. So that ruling
would have built a *second reachability instrument that nobody walks* —
and one the drawn paths defeat: a lane-following edge rule refuses
exactly what the chord refuses (seed 13's gate approach crosses a 3.3 m
deck transversely, push 0.38–0.42 either side; seed 15's spur crosses a
ramp sideways through its flank walls, push 0.55/0.52; the paving twin
clears neither), while NavGrid's real seed-15 route rides the bridge
lengthwise along x = 34 and steps off the ramp toe — a legitimate walk no
lane rule can express.

**Ruling (Architect, 6 Sep, second):**

1. **`PoiGraph.reachable := "NavGrid can route here from the park's main
   body (the entrance)"`** — the same instrument `check:park`'s
   `route.unreachable` already uses, computed per space with the same
   NavGrid the `JourneyPlanner` builds. **One instrument, not two kept in
   step**; *NPC-reachable ⊇ player-reachable* then holds by construction
   because they are the same predicate. Edges survive only as a cheap
   prefilter, if at all — never as the verdict.
2. **`poi.stranded` stays hard** and means *"the children's own planner
   cannot reach this waypoint"* — a real defect whenever it fires. It is
   **0 on seeds 0–15** under this definition. Seed 6's `poi.nospot`
   (samples on the railway under a deck) is discharged the same way: a
   spot is a spot NavGrid can stand on.
3. **The layout redraw (rung, refusal shape, trace, digest) stays armed**
   for the genuine case and prints "rung never fired" every run. No
   placement moves. Seed 5's warp retires when and because it builds
   without it.
4. **Conditional on the caveat being checked, and the ruling depends on
   the answer**: whether NavGrid *over-approximates* at those transverse
   crossings — a 1.9 m step onto a ramp top would be a **NavGrid bug**
   (it is the player's walker; a child would be walking through a
   parapet), fixed in NavGrid, never accepted as reachability and never
   compensated by widening anything. The seed-15 route needed no such
   step; the check is whether any route the new `reachable` relies on
   does. That measurement lands in the same PR, red or green, by name.
5. Seed 12 (`anchor.reach:waterFight`, built 19.5 m vs declared 18.5 m)
   remains its own item — declared-versus-built, in the plot's builder.

**Condition discharged, extension confirmed (6 Sep).** `NavGrid.reachableFrom`
(`2da54979`) floods exactly the steps `findRoute` searches — `forEachStep`
is the single owner of what a step is, and `search` walks it too — and
agrees with per-waypoint `findRoute` on **224/225/245** waypoints across
seeds 13, 15, 0 with zero disagreements, answers false off-park, leaves
`check:park`'s routing findings identical, in 7 ms against 1.0–1.4 s.
NavGrid does not over-approximate; it correctly refuses the transverse
crossings. **Extension confirmed**: a node is placed at **NavGrid's
nearest standable cell** — `nospot` is `stranded` asked at placement
time, same owner.

**What the true definition finds — real defects, not classifier noise**,
and where each belongs:

- Seed 13, 4 of 224 route samples standing **inside a collider**: two at
  the deck edge of the gate approach's transverse crossing, one on the
  ramp crossing, one inside the lineside fence's stamp on
  `spur-waterFight`. Seed 6, 8 of 271, including a station stand at
  (−25.0, 16.6) inside the fence stamp.
- **Seed 6, four gate-approach samples on the railway** at x = 0,
  z 34.8–46.3, rail distance 0.3–1.8 m, **with no deck under them** — the
  drawn lane of that crossing does not lie on its own bridge's deck.

The second is the crossing family's, seen from the other end, and it is
folded into the commit-time crossing predicate now: **a crossing that
snaps to a site is still a foul if any of its drawn samples inside the
rail corridor is not covered by that site's deck footprint** (the deck's
own owner, `bridgeFootprint` / `bridgeHeightAt` non-null). Same predicate,
one more clause; the recovery contract's rungs apply unchanged (re-route
the lane onto its deck; on-demand site; named failure). The samples
inside colliders are the same disease one class over — a drawn route
standing in something solid — and are the universal invariant's; the POI
rung reports them by name and does not move a placement for them.

The rung therefore takes the class from five red seeds to **a handful of
genuine defects, named** — a better result than zero, because what
remains is real.


**On the record**: this is the third premise this engineer has corrected
by reading the code rather than the document, and each correction made
the design simpler. The Architect's error both times was inferring a
walker from an import list; the rule that follows is in "Traps" below —
**name the consumer, not the importer.**

**Baseline corrected**: 4 of 16 build (0, 5, 11, 14), not 2.

**A false refusal, measured (6 Sep), and the rule it sharpens.** Rung 1
refused the castle's doormat on seed 1 and redrew the castle. The door at
(−28.5, 24.7) sits 5.49 m from the ball pit's centre, inside its 7.5 m
footprint circle **by design** (the near pair: the slide exits into the
pit). In the layout-time world every footprint is solid and fattened by
the walker, so nothing within 2.2 m is standable; in the **built** park
the nearest standable reachable spot is 0.07 m from the door and the only
collider within 2.5 m is a turret 1.30 m clear. The ball pit's footprint
is walkable ground. So "a door covered by another plot's footprint is
certainly bad" is false, and there is no safe over-approximation while
the layout-time world cannot tell a solid from a surface.

**Rule, binding on every rung that reasons about a partial world:** *a
probe exploring an over-approximate world may refuse only what is
certainly bad on that world's own terms — and if the world cannot express
"walkable", nothing is certainly bad and the probe must not refuse at
all.* A refusal on an over-approximation redraws real geometry to satisfy
a measurement error, which is the failure the totality contract exists to
prevent. The engineer's guard — refusals ignored under a scratch flag are
asserted genuinely unreachable in the built park, else
`layout.falseRefusal` — is the net; it stays, on every run.

**Where the distinction lives — ruled.** It is the claim kinds, and the
registry is its home; that is what `footprint` versus `walkable` /
`surface` were defined for, and `CLAIM_COMPATIBILITY` already says a
corridor and a stand spot are welcome on walkable ground. What is missing
is not a new field but the **plots' migration** — stage 5's first row,
"plots first (everyone re-derives their circles by hand)" — brought
forward, because this is the third consumer in a week to invent the
solid/surface answer privately (#503, #504, now the layout probe):

- **One owner per plot: the thing that draws it.** A plot's builder
  publishes its claims — `footprint` for what is solid (the ball pit's
  rim and walls, a booth's body), `walkable` for ground a child stands on
  (the pit's floor, a plaza), `surface` for a deck — describing the
  *drawn* geometry (#504's variant). Not a manifest flag: a flag beside a
  radius is a second definition of the shape, and the manifest already
  lies about one radius (#504's bush).
- **`PARK_LAYOUT`'s circles become the plots' *provisional* claims** at
  layout time (a footprint disc is the conservative shape while nothing
  is drawn), realised by the builder into their kinds when the plot is
  built — the provisional-then-realised mechanism the road already uses.
  Until a plot is realised its provisional claim is `footprint`, and by
  the rule above **a layout-time probe may not refuse on a provisional
  footprint** — it may only note "unresolved" and defer the verdict to
  the commit (the built NavGrid).
- **Interim, accepted**: the layout probe's obstacle set is *what the
  router itself treats as obstacles*, read from its one owner
  (`streetPlots` or its sibling) — the same function the paths' commit
  uses, so an explore-yes/commit-no disagreement has one legal cause.
  **If nothing owns that set today, the answer is not a manifest field;
  it is the plots row above, and the probe refuses nothing until it
  lands** (the built verdict still arms the rung).

`headroom` on a corridor claim and `standable` on a footprint are the same
idea — a claim saying what may share its ground — and both belong on the
claim, not on the consumer.

**Determinism — the rule that keeps a seed meaning something.** A park
that reached decision zero is *a different park than seed n nominally
asked for*, and that is fine; what is not fine is a park that is not a
function of its seed. So:

- every attempt counter is folded into the stream name, never a global
  counter; the refusal sequence is itself deterministic (fixed round
  order, fixed blocker choice — most recent — no map iteration), so
  the trace `seed → [decisions, refusals, unwinds] → park` replays
  exactly. Two builds in separate processes, identical, is the proof
  and is already the digest instrument's job;
- the **unwind trace is printed to stderr on every build** (per seed:
  refusals, negotiations, unwinds, whether decision zero was reached and
  how many times) and its hash is folded into the park digest, so a
  regression is reported as *"seed n now reaches decision zero, it did
  not before"* — repeatable, and visible on the seed, not on a
  randomly re-drawn one;
- the *nominal* park (attempt 0 throughout) is a thing a check may
  still describe, because "this seed needed unwinding to build" is a
  thrash number worth watching — but it is a quality signal, never a
  buildability verdict.

**What proves it — `check:every-seed-builds`, honest about two words.**
Builds seeds **0–15 and a rolling random draw** (stage 5's nightly sweep
brought forward as the instrument; the fixed sixteen so the numbers are
comparable day to day) in separate processes and reports, per seed, on
**two separate lines that are never merged**:

- **built**: no throw; every hard-tier demand served (no stranded POI,
  every door reached, every crossing on a proven site, every elevated
  structure supported); unwind trace printed. This is the gate — red on
  any seed is a broken generator, and it is proved red first by making
  the layout throw on a known seed;
- **built well**: the soft tier and the thrash numbers — unwinds, decision
  zero reached, attempts consumed — reported as measurements with a
  ratchet, not as pass/fail. "Built" can be green while "built well"
  says a seed needed three restarts; that is a true statement about the
  generator and the whole reason the two lines are separate.

The seed pool (`parkSeedPool.ts`, #584) survives only as a *quality*
curation over "built well", never as the reason a seed is playable;
stage 5 deletes it. **No warp field, no vetting step and no seed
retirement may ever be the answer to a seed that does not build.**

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

#### Stage 3, re-examined (5 Sep): the pair is over-determined, and that is a ruling, not a bug

The sequencing above ("let #498 land first, then beat it") is withdrawn.
`fix/road-487-488` (PR #498) did not land; it stalled, and *why* is the
stage-3 finding — measured by the hand fix on all sixteen seeds before a
line of the migration was written. Read from the PR, its two unanswered
reviews and its handoff, 5 Sep:

- **Main's road is a chord along the wall** (`ENTRANCE_BUS_STOP_Z`, the
  wall plus nine metres) because the cat bus drives *past* the gate and
  stops in front of it — the arrival sequence. #498 curves it to hug the
  wall at a constant outset, but it stays parallel to the wall.
- **The rail-race ring is not a route.** By the family's brief (31 July,
  `railRace/route.ts`) it is the park's perimeter, a circle flown high,
  "not solved, grown or steered"; its feet stand at `NOMINAL_OUTSET`
  6.5 m, boxed to **[6.15, 6.92]** by the masonry inside and the hillside
  outside. The ring is a *fixed* decision in the design's sense, like the
  boundary — an earlier draft of this section said "the ring re-routes";
  it cannot, and that draft is struck.
- **The geometry, #498's own numbers:** a 7.78 m road needs its centre at
  outset ≥ 3.89 (outside the park) and ≤ 8.11 (off the 17 m hillside
  that starts at `RIM_OUTSET_START` 12); clearing a foot at 6.5 needs the
  centre ≤ 2.1 or ≥ 10.9. **The bands do not intersect.** A road crossing
  the trestle line is fine (12 m spacing against 7.78 m); a road
  *parallel* to it cannot fit anywhere.
- So the named clause's legs step aside — all of them along the road —
  and on **5 of 16 seeds** the rings stand on air for **61–67 m** against
  main's 40 m support invariant; the nudged legs lean, and **8–9 posts
  per seed** still pass through the bus body at height (the review
  blocker). The engineer's only exit is to **re-sculpt the hilltop apron**
  (`RIM_OUTSET_START` 12→16, `RIM_OUTSET_END` 22→26) — "needs Jim's yes,
  not started".

**What this means for the design.** "Procgen backtracks on collision,
always" presumes some decision *owned by the generator* can change. Here
every party is human-ruled: the ring's outset (family brief + masonry +
hill), the road's line (the arrival sequence), the flat apron's width
(terrain). The generator owns none of them, so no backtracking — hand-
written or round-robin — can make this pair green on those five seeds.
Stage 3 as chosen is therefore **not a test of the rework**: neither the
hand fix nor the migration can win it, and building the migration first
would only rediscover the empty intersection at greater cost. The
totality contract has a name for this: an over-determined constraint set
is a *design* fault, surfaced loudly, never patched by a warp field or a
fallback — and it has surfaced. The decision point's question is
deferred, not failed.

**The ruling this needs from Jim — one of these gives:**

1. **The flat apron widens** (the engineer's proposal): the road then runs
   *outside* the ring at outset ≥ 10.9 and never meets a foot. Visible
   terrain change (the hilltop grows ~4 m all round, or locally at the
   gate). Stage 3's pair becomes nearly trivial — the legs never conflict
   — so it stops being a useful first negotiation.
2. **The bus arrives radially** (drives *toward* the gate, not past it):
   the road crosses the ring once, two feet step aside, spans stay under
   40 m. Visible change to the arrival sequence and #491's camera. Stage
   3 stays exactly as briefed, small and real.
3. **A support that straddles the road** — a portal/gantry trestle with
   feet either side of the corridor, or a vertical post at ≥ 10.9 with an
   arm back to the ring. Geometrically possible: the ring's lowest point is
   `BASE_HEIGHT` 9.5 − `UNDULATION_REACH` 2.95 = 6.55 m against a bus body
   to 5.62 m, ~0.9 m before deck thickness — a measurement, not a yes.
   Authored geometry (3D Artist), and a *support kind* decision of the
   placer: this is "a feature's own supports are claims" gaining a second
   support shape, stage-4 work brought forward.

#### Stage 3, ruled (5 Sep, Jim): "there should be no 'flat ground' — it is a sphere"

Jim rejected the premise of all three options. No party yields: the park
comes off its hill (#511) and the ground becomes the surface of a large
sphere, and the over-determination is expected to dissolve because both
ceilings were the hill. Traced to source by an Engineer, and it holds as
algebra:

| bound | value | owner | survives the sphere? |
|---|---|---|---|
| trestle band inner | 6.15 | masonry clearance `1.07 + 5.08` | yes |
| trestle band outer | 6.92 | `RIM_OUTSET_START (12) − 5.08` | **no — hill** |
| road centre floor | 3.89 | `ROAD_HALF_WIDTH`, outside the park | yes |
| road centre ceiling | 8.11 | `RIM_OUTSET_START − ROAD_HALF_WIDTH` | **no — hill** |

The road's outset is not chosen: it derives from the bus door,
`DOOR_PAVEMENT + BUS_DOOR_INBOARD` = **8.26**, which exceeded the 8.11 hill
ceiling by 0.15 m — that crossing *was* the over-determination. The
sphere deletes the ceiling and nothing else: 8.26 is a **floor**, and the
road may now sit at any outset above it.

**Struck the same day (5 Sep, #511 Engineer's correction):** an earlier
draft of this section had the trestles "escaping outward" to a foot at
outset ≥ 12.66, and asked whether the nudge search should be extended to
reach it. **A radial nudge is a lean, not a placement.** `track.ts` keeps
a trestle's top under the rails and moves only the foot
(`strut(legs, …, trunkFoot, trunkTop)`), so a +6 m nudge is a trunk
leaning 6 m, and 12.66 was never a placement the generator could not
reach — it was not a placement at all. Extending the range would have
produced absurd geometry the invariants would then have been told to
tolerate. The resolution is the other way round: **the road moves outward
past the ring's band**, its own freedom, no party yielding. The ring's
ground occupancy today is outset **1.42–11.58** (`NOMINAL_OUTSET` 6.5,
nudges ±5, foot radius); the road branch is trying a centre near **16**,
which clears a most-nudged foot at 11.5 by 4.5 m against the 4.4 m the bus
needs — a **0.1 m margin, derived from feet**.

Two design facts fall out of that, both binding on step 2:

- **The road's outset is a decision, and "16" must not be a typed copy of
  the trestle search's reach.** "Clears ±5 nudges plus a foot" is the
  trestle placer's knowledge; a constant in the road that restates it is
  the two-definitions disease, and it goes stale the moment step 2
  deletes the nudge ladders (the band changes). Interim, before step 2:
  the ring's ground band has **one owner in `railRace`** (exported,
  derived from `NOMINAL_OUTSET`, the nudge reach and the foot radius) and
  the road reads it. From step 2: the road's turn **asks the registry** —
  its corridor claim marches outward from the 8.26 floor until the one
  function allows it against the trestles' committed claims. Whether
  that makes the road's outset seed-dependent, and whether Jim wants
  that, is a visible question for step 2's PR, not a thing to decide
  here.
- **The 0.1 m margin is thin, and it is the feet that bind, not the
  posts.** With the road *outside* the ring, a nudged trunk leans
  **inward** (foot at ≤ 11.5, top at 6.5), away from the road — so the
  posts-at-height prediction below does not apply to this configuration.
  The one geometry that still reaches outward at height is the race
  ring's outer branches (`WIDEST_HALF_SPAN` = 4.125 m at `RIDE_SCALE`,
  outer lane at outset ~10.6, fork nodes below `beamY` 6.35 m); step 2a
  measures them along with everything else.

**Caveat, binding until discharged:** the above is constant algebra, not
a built park. Step 2a's instrument (the bus's swept body against the
**drawn** posts and branches at height, every seed, ratcheted) is the
measurement; the five seeds #498 was red on (5, 11, 24, 131, canonical)
are the ones to watch. `test:procgen` on the sphere branch is 9 failed /
667 passed with the sole cause isolated to #498's corridor clause, which
is being deleted.

**Measured (5 Sep, #511 Engineer, built parks, corridor clause still
active — i.e. the original geometry, road not yet moved), with a control:**

| seed | legs | leaning | worst lean | feet in bus | posts in bus |
|---|---|---|---|---|---|
| 5 | 89 | 1 | 1.00 m | 1 | 2 |
| 11 | 90 | 0 | 0.00 m | 2 | 2 |
| 24 | 92 | 2 | **4.00 m** | **0** | **2** |
| 131 | 89 | 1 | 3.00 m | **0** | **1** |
| 326 | 91 | 1 | 2.00 m | **0** | **1** |
| canonical | 91 | 1 | 1.00 m | 1 | 2 |

The first prediction ("clears feet, not posts") is **confirmed**: on
seeds 24, 131 and 326 the feet are entirely clear while one or two posts
stand inside the bus at height. So `check:entrance-road`'s "0 legs hit on
all sixteen seeds" was true and useless on three of the five seeds that
mattered — the sharpest statement yet of why a feet-only headline cannot
be inherited, and why step 2a sweeps the drawn geometry. Two caveats,
the Engineer's own: seed 11 has nothing leaning, so foot and post cannot
differ there and that row is evidence of nothing (the instrument says so
on stderr rather than report an agreement it did not earn); and the worst
lean is **4.00 m**, double the 2 m a reviewer had on record.

**Prediction, restated (5 Sep, after the correction), **still unmeasured** — the road-outside-the-ring build is
next, and the Engineer reports the real foot margin, not the derived
0.1 m:** *for a road outside the ring's band, the drawn posts at height
are clear wherever the feet are clear*, because nudged trunks lean
inward; *the binding number is the foot margin (0.1 m at centre 16)*,
and any seed where it fails will fail at a foot, not a post. If step 2a
finds a post or branch in the bus body on a seed whose feet are clear,
this paragraph is struck and the support-shape branch below goes live.
**The support-shape branch is kept alive either way** — a trunk that
rises vertically to headroom before it forks (`forkPlan`; Artist input
on the look; "a feature's own supports are claims" gaining a second
kind) — because it is the only "different decision" a support has when
its foot is refused and its lean is exhausted.

**Ruling on `RADIAL_NUDGES` (Architect, 5 Sep) — unchanged by the
correction, and better for it.** `RADIAL_NUDGES`, `MANDATORY_RADIAL_NUDGES`
and `WIDE_RADIAL_NUDGES` are three typed reaches forming a three-tier
fallback ladder — the exact shape "Backtracking, one mechanism instead of
six" deletes, and a typed reach is a "constant restating something
computable". The trestle placer's foot search **marches outward from the
ring asking the registry with the one function, and stops where the
world says so** — a claim refuses it, or **the support's own geometry can
no longer reach the rails** (the lean limit, derived from
`trestleGeometry.ts`'s `MIN_TRUNK_FRACTION`/`BRANCH_ANGLE`, one owner) —
never where a list does. Not "where the ground ends": on a 1200 m sphere
the ground never ends, and terrain height is no longer seed-dependent
(`terrain.ts` dropped `PARK_BOUNDARY` with the rim). Three consequences:

1. The three ladders are deleted together; one search, one predicate,
   one ordering (nearest-first, deterministic).
2. The claim it asks with **describes the drawn geometry** (#504
   variant): the plan projection of everything of the support below the
   road corridor's headroom, not a foot disc. The road's corridor claim
   carries its headroom (the bus's height from its own owner plus the
   clearance step 2a uses — one owner, read by both), because a ring
   passing *over* a road is fine and a trunk through one is not.
3. When the lean is exhausted and the foot is still refused, the
   placer's "different decision" is a **support shape**, not a further
   foot. If no shape serves, the refusal propagates — never a silent
   skip, never a warp field.

**Step 1's correction, folded in.** The road is **not** constants: the
kerb's ends measure against `PARK_BOUNDARY`, and the spur's inner end
against the plaza's *live* paving — `publishPaving()` runs inside
`new World(...)`, after generation, so at generation the spur ends at
z = 52.00 and once drawn at z = 55.91. Step 1 resolved it with
`roadCorridor.ts` as the one owner plus a **re-commit once paths exist**.
That is the provisional-claims mechanism, not a special case: the road's
first turn commits a provisional corridor, its second realises it when
the paving is published, both through `GroundClaims.commit` on the same
feature name (the registry keeps the feature's order across re-commits).
Two things follow for the later steps. A reader of the road's claim
between the two turns reads a provisional shape — the trestles are built
at `World.ts:214`, the entrance at `:268`, so **step 2's legs are placed
against the provisional corridor unless the order is fixed**; the spur
end moving 3.9 m must be shown not to reach any foot, or the legs' claims
must come after the realisation. And `publishPaving()` running inside
`World` is a post-generation commit by the paths — a stage-4 item, listed
there so nobody re-files it.

**The steps, re-cut for the sphere world:**

1. **Road becomes the first production placer** — nearly landed (byte-
   identical on all 16 seeds, two controls, four deliberate breaks).
2a. **The instrument, first and alone** (`BRIEF-stage3-step2a-swept-bus-instrument.md`)
   — dispatchable today, no dependency: the bus's swept body against the
   *drawn* trestle posts at height, every seed, as a ratchet with a
   baseline (the `check:coplanar` precedent), so it merges while `main`
   is still red on it and step 2 drives it to zero. Watched failing is
   its own definition of done.
2. **Trestles become claims, the road asks the registry**
   (`BRIEF-stage3-step2-trestles-claim.md`) — dispatchable when #511 (the
   sphere + the road outside the ring) and step 1 are both on `main` and
   step 2a's ratchet is in the chain. The park changes wherever a foot
   stood in the road (#498 counted 2–8 per seed) and wherever the road's
   derived outset differs from the interim constant — visible, Jim signs.
3. **Confront the ladder** — unchanged, after step 2; the road is now a
   genuinely two-turn task and the ladder confrontation must keep that.
4. **Negotiation** — the first support-shape negotiation and the
   `CoSolveEngine` migration onto `GroundClaims`; its size depends on the
   measurement (if the sphere alone clears the posts, it shrinks to
   counters + the engine move).

#### Steps 3 and 4, re-cut (6 Sep) — what the code turned out to be

Read against the code before the briefs were re-cut (`parkGeneration.ts`,
`solveScheduler.ts`, `groundClaims.ts`, `coSolve.ts`, and step 2's branch),
three facts the step list above did not state, and the rulings they force:

- **The trestles are not a scheduler task after step 2.** Step 2 makes
  each leg a claim, but `trestleSpots` still runs at `RailRace`
  construction inside `World`, against the letterboxed registry. So "the
  two migrated placers interleave" has nothing on the trestle side to
  interleave until **step 3 makes a `railRaceSupports` task** — both
  rings, sliced per slot, output letterboxed to `World`, `RailRace`
  consuming it and re-solving only when the letterbox is empty. Its
  `collision.isClearCircle` legacy predicate has no generation-time owner;
  step 3 measures what it was refusing on every seed and either drops it
  with the number or names the collider's own owner as a legacy predicate.
- **The road task is last by declaration, not by data**: `roadCorridor` is
  registered `deps: ['pathGraph']`, and its second turn is `World`
  re-committing after `Entrance` because `publishPaving()` is called from
  `buildPaths()` (a draw). Step 3 splits it into `roadCorridor`
  (provisional, `deps: []`) and `roadCorridorRealised` (`deps:
  ['pathGraph', 'roadCorridor']`), and **brings forward one stage-4 item
  only: `publishPaving()` moves into the `pathGraph` task** (the graph is
  solved there already; publishing is data readiness). The paths do not
  migrate.
- **Neither placer in the pair draws randomness** (both are nearest-first
  marches), so step 3's park is expected byte-identical unless the two
  measurements above move a leg. The decision-stream owner
  (`hash(seed, feature, decision, attempt)`) still lands in step 3, as the
  decision log's owner; the PR says in words that no draw goes through it
  yet.
- **Step 4 is the scheduler learning the ladder, not "a loud failure".**
  `SolveScheduler` absorbs `CoSolveEngine`'s mechanics (attempt, withdraw,
  negotiate, unwind, restart, counters) and both `coSolve.ts` and
  `PlacementField` are deleted; a task returns a `Refused` value instead
  of throwing; the trestle throw becomes that refusal; the road's next
  attempt is the nearest outset past the refusing claim's extent (derived,
  finite). The scheduler's own decision zero is wired and proved reachable
  under a scratch flag; the **layout's** decision zero is not reachable
  from a scheduler refusal until the layout is a task (stage 4), and the
  trace says so on every run. The support shape is built only if a seed's
  refusal survives the road's negotiation on the sphere — measured first.
  A refusal surviving every rung with the flag off is a bug that stops the
  PR, per Jim's ruling; it is never a designed terminal state.

The briefs (`BRIEF-stage3-step3-confront-ladder.md`,
`BRIEF-stage3-step4-negotiation.md`) carry the detail; this section is the
authority they cite.

#### One rail race (Jim, 6 Sep) — the two rings are never in the world together

Jim: *"either the small one or the big one is shown — it is purely a
visual trick, they never occupy the world at the same time."* Confirmed in
code: `RailRace.setActiveRing` shows exactly one ring's group; invariant
"only the walk-past ring is solid" already forbids the race ring a
collider because it is hidden except mid-race. **There is one rail race,
drawn at one of two scales.** Anything that makes the two rings clear
each other describes a world that never occurs — on the canonical seed
that was ~100 race-ring candidates refused by `legacy:collision` at
exactly 1.0 m from walk-past posts (1.1 m clear circle), pure waste.

Ruled, as deletions rather than better-shaped claims:

- **One feature name, `railRace`**, for both rings' claims. The registry
  never refuses a feature with its own claims (`refusalsOf` skips the
  asker), so the rings stop constraining each other with no
  exemption-by-identity; the road and everything later still see the
  union, because either ring can be shown while they are there.
- **The walk-past ring's colliders are registered after both rings are
  placed.** They stay — a child on foot, `NavGrid` (so every NPC route),
  `LampPosts` and `check:park` all read them, and none of that is
  cross-ring — but they are for feet on the floor, not for placing the
  ride ring, so the race ring's search never sees them.
- The walk-past × race pairs vanish from the registry sweep; the
  three-feature probe becomes `[road, railRace]`; per-ring facts compare
  each ring's drawn claims to its slice of the one feature's.

Open with Jim: the race ring exists only mid-race, when the bus is not on
the road, so its headroom clip and its feet's refusal by the road corridor
are also for a co-presence that cannot happen. Until he rules, both rings
keep respecting the road; `check:swept-bus` sweeps the walk-past ring's
posts (the first `railRace:trestle-legs` in the scene) and should say so.

#### The road rule (Jim, 6 Sep) — legs over the road are skipped; nothing else changes

Jim, asked whether the ride-scale ring may stand on or over the bus road:
*"just skip all the legs over the road, otherwise keep them — one simple
rule is all we need here."* The rule, as an engineer implements it:

> A trestle slot whose foot disc (`POST_FOOT_RADIUS` at the ring's scale)
> at its nominal position on the ring overlaps the road's corridor claim —
> `entranceRoadClaims()`, whose `halfWidth` **is** `ROAD_HALF_WIDTH`, the
> drawn carriageway, no outset — is not built: no search, no lean, no
> shape, on either ring. Every other slot is placed exactly as today; a
> march candidate that lands on the road is refused like any other claim.

"Over the road" has one owner because the corridor claim and the drawn
carriageway are one number. Cost, measured on the branch: on the sphere
the road sits at outset 19.07 against a ring ground band ending at 11.58
plus a foot, so the rule fires on **zero** slots on every pool seed and the
40 m-run and duck-bar invariants are untouched. A road that ever crossed
the band would cost at most one slot per radial crossing (12 m spacing
against 7.78 m of carriageway — a 24 m gap); a *mandatory* duck-bar slot
over the road loses its post and `duckBarsStandOnRealSupports` says so —
the alarm, and the day for a second clause, not now.

**Final form (Jim, 7 Sep), after the duck-bar alarm fired on two seeds:**
*"ok fine, make the big version have all its legs, but the normal version
can have them selectively."* So: **the ride-scale ring ignores the road
entirely and keeps every leg; the walk-past ring applies the rule and
skips its own.** The alarm was the ruling's design doing its job — put to
Jim as "two of fourteen pool seeds lose one bar for one racer", answered
with the number in front of him. Seed 131's slot was the race ring's and
clears; seed 326's is the walk-past ring's and may not — if it does not,
that is the rule costing exactly one bar on one seed, **accepted**, and it
goes in the PR body as an accepted cost, not back to Jim.

**The one fact this rests on, stated once because it is now load-bearing
in two places:** *the two rings are never in the world at the same time.*
The one-feature change (the rings do not constrain each other) and the
rule's asymmetry (the ride ring may stand over a road the bus is never on
while it exists) are both consequences of exactly that fact, and nothing
else. If it were ever false — a design that showed both rings at once, or
the bus on the road mid-race — **both are wrong together**, and the first
thing to re-examine is `RailRace.setActiveRing`, the one place the fact
lives in code.

**Fairness is the race ring's property (Architect, 7 Sep).** With the
final form in, seed 131's walk-past ring reads 10/10/9/10 duck bars per
lane. `RailRace.ts` on that ring: *"nobody is racing, but the rivals do
not know that — they carry on"*; no standings, no winner, no player.
Equal-per-racer — Jim's 7 Aug ask, "what makes the race fair" — is a
property of the race, and the race happens on the ride-scale ring only,
so asserting it on the walk-past ring measures the wrong object. Re-cut:
equal-per-racer on the race ring; on the walk-past ring, no-two-touch
stays and each lane's count equals the race ring's for that lane minus
the bars whose slot the road rule skipped there, the skipped count
printed per seed — a bar missing for any other reason is still caught,
and the rule's cost is stated on every run, never tolerated silently.

**What the rule makes unnecessary** — each a rule the generator would
otherwise imply and no longer applies, so deleted, not left:

- `Claim.headroom` and `GroundClaims.tallestHeadroom`; the corridor claim
  carrying a bus height; `trestleClaims`' headroom parameter — the clip
  stays, at `TALLEST_CHILD_HEIGHT` from `kid.ts`, because a claim describes
  what a walker meets near the ground.
- The road's outset marching the registry against trestle claims, and the
  deletion of `supportGround.ts` (step 2 phase 2, item 3): the road no
  longer avoids trestles — they skip it — so it stays where its band owner
  puts it.
- **Step 4's negotiation has no customer.** A trestle refused by the road
  is skipped, never negotiated, and the road is never refused by a
  trestle; "the first negotiated pair" has nothing to negotiate. The
  scheduler's ladder lands with the first placer that genuinely returns a
  refusal (stage 4's paths), not as a mechanism exercised by a check that
  cannot fail.

**What stays**: `CAT_BUS_TOP` (label, asset contract); `CAT_BUS_DRIVEN_TOP`
and the posed-crown derivation, as the owner `check:swept-bus` reads — the
check is now the instrument that proves the rule against the drawn park
and the alarm if a kept branch ever hangs where the bus drives;
`suspensionTravelAt` for the chin, wheel and step.

#### Two roads met (6 Sep) — ruled: one road, `roadCorridor` shape, `roadRoute` geometry

The sphere branch carries `roadRoute.ts` (#498's arc, now at outset
19.07 m from `supportGround.ts`'s published band, with the arc-aware
`check:swept-bus` at 0 drawn posts on fourteen seeds); `main` carries
step 1's `roadCorridor.ts` (the one owner of the road's segments and
claims; `check:ground-claims`). Step 1 *knew*: its brief was re-cut off
`roadRoute.ts` when #498 stalled, with "if it lands later the claim
follows its owner" — the shape was built to receive the arc. Not a
duplication; a sequencing seam, closed as follows:

- **`roadCorridor.ts` stays the owner of what the road *is* to everyone
  else** — `entranceRoadSegments()` / `entranceRoadClaims()`, the
  provisional-then-realised commit, the letterbox, the invariant.
- **`roadRoute.ts` becomes the geometry it returns.** `entranceRoadSegments()`
  samples the arc (from `roadRoute`'s own owner of the outset, which reads
  `supportGround.ts`'s band — no copy of 19.07 anywhere) into straight
  runs; `RoadSegment` is generalised from axis-aligned `across/along` to an
  arbitrary `from → to` (a capsule claim already is one); claims become
  **one capsule per run**, and the "exactly two" probe becomes "claim
  count == segment count, and each claim is its segment".
- **`Entrance.ts` draws from the segments** using the sphere branch's arc
  ribbon builder; nothing in the builder or the claim re-derives an
  endpoint. The spur (gate approach) keeps its provisional/realised end.
- `check:ground-claims` and the road invariant measure oriented bounds
  per run instead of axis-aligned; probe 2b, probe 3 (`===`) and probe 4
  (byte-equality with the owner) unchanged.
- `check:swept-bus`, `supportGround.ts` and the ring band are **untouched
  in substance**: they read the road through its owner. If any reads
  `roadRoute.ts` directly, redirect the read to `roadCorridor.ts`'s
  exports or make `roadRoute` a private import of it — one owner chain,
  whichever is fewer lines.

**Proof the merge changed nothing it should not**: the sphere branch's
park digest on all fourteen building seeds before and after (the road's
geometry must not move by a millimetre — `check:swept-bus`'s bidirectional
ratchet says so independently at 0 posts), and `check:ground-claims`
green with the arc. **Honest size: one engineer, half a day to a day** —
the #511 engineer, who holds both sides' measurements; the risk is in the
oriented-bounds rewrite of the invariant, not in the geometry.

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

#### Warp vectors (#474, 4 Sep): baked backtracking, retired by stage 4

`src/world/parkWarp.ts` ships a per-seed table of *decision overrides* —
`layout` (a placement-stream bump per manifest entry), `layoutRestart` (a
whole-layout re-roll) and `banCrossingsAt` (rail distances the crossing
march must refuse, so `selectSpaced` takes its next-best spacing) — found
offline by `scripts/warp-search.mts` and replayed through the whole
deterministic pipeline; a warp never edits a built park in place. Read
against this design it is **backtracking done by hand, once, per seed**:
each vector is the decision a round-robin generator would have reached on
its own by refusing a claim and retrying — a layout that put an attraction
where a crossing had to go, a crossing site that a later feature could not
live with. That is the right interim under the sixteen-seed ruling (the
alternative was silent fallbacks, which #474 rightly replaced with loud
throws), and it is also a reservation-shaped artefact of exactly the kind
the epigraph warns about: an overview (the offline search) deciding ground
before the features that want it exist.

So, binding for stage 4: **when crossings migrate to negotiated,
provisional-then-realised claims, `banCrossingsAt` has nothing left to
ban** — the march is exploration and a site a sibling cannot live with is
refused at commit, on the seed, at build time. The `layout*` fields retire
with the plots' migration (stage 5, first row) for the same reason. The
acceptance for each is measured: the pool builds with that field deleted
from every vector, `check:park` and `test:procgen` green. Until then the
table stands, and no migration PR may add a *new* warp field to get a seed
through — a seed the migrated placer cannot build is a finding about the
placer, per "Procgen backtracks on collision, always".

Also noted from #474, no design change: `crossingSitesSearch` now fails the
build rather than publish a loop with no bridge site, and `paths.ts`'s
ad-hoc `manhattanRoute` escape is gone. Both harden the *current*
committed-too-early shape rather than move it, and the crossingSites
section above (march becomes exploration) is unchanged by them.

### Stage 4 — paths, railway, crossings migrate together (large; parks change)

*Filed here from stage 3 (5 Sep): `publishPaving()` runs inside `new World(...)`, after generation — a post-generation commit by the paths that the road's second turn today has to wait for. **Re-filed 6 Sep: the publishing alone moves into the `pathGraph` task in stage 3 step 3** ("Steps 3 and 4, re-cut"); the paths' migration itself stays here.*

*Also filed (5 Sep, from the #511 branch's `test:procgen` run): **seed 288
throws during park construction on a bridge-siting failure** —
`crossings.ts:432`, "the drawn paths cross the railway at railD 35.1
(−36.2, 2.8), which snaps to no proven bridge site", reached through
`Scenery` → `isPlantable` → `onRailway` → `isInBridgeFootprint` →
`computeCrossings`. It does **not** reproduce on `main` at `61e95fe5`
(88 passed): the hill happened to hand the planner sites it liked, and
moving the ground everywhere exercised the brittleness the hill had been
hiding. **Latent, not absent** — filed on the stage-4 list as the first
real customer of "crossingSites: the march becomes exploration": a site
that cannot be realised must be refused at commit and the next candidate
tried, never a throw after the march has published it as fact. The seed
itself is the #511 Engineer's to fix (it exposed it); the general
throws-instead-of-backtracks shape is this design's. Its silent half — 90
skips that were one whole file failing to *build*, reported as quietly as
any skip — is issue #524, independently ownable: a park that cannot be
constructed is the suite's most severe result and must be its loudest.*

#### Seed 288, root-caused (6 Sep): the path router and the site solver disagree, and the fix is a refusal, not a tune

The chain, found by the #511 Engineer and confirmed by experiment
(restoring `terrain.ts`'s `PARK_BOUNDARY` edge as a side-effect import
gave an identical failure at an identical coordinate — geometric, not
init order): the sphere lowers the ground away from centre, so
`cruiserLowPoints()`'s 5.9 m clearance test (`plan.ts:256`) qualifies
fewer points → the low corridor shrinks → the station moves → the train
route moves → `TRAIN_PLAN` feeds `crossingPlanSolve` → **`CROSSING_SITES`
move** → a drawn path crosses the railway at railD 35.1 with no site
within `SITE_SNAP_TOLERANCE` 8 m → `crossings.ts:432` throws. Nothing in
the chain is individually wrong; two generators simply have no contract
between them and the hill kept them agreeing by accident.

Read from the code (`paths.ts`, `crossings.ts`, `crossingPlanSolve.ts`):

- `routeLeg` is the only *legal* crosser — the rail corridor is an
  obstacle everywhere and the sites are its only apertures. But the drawn
  geometry `computeCrossings` measures is produced by several things that
  never ask the railway: the spur's `lead`/`past` points (`paths.ts:3905-3915`),
  station approach points (`:4060`), connector `leadA`/`leadB` (`:4514-4520`),
  the lattice-snap joining jogs (`:2971-2973`, which say so), the
  draw-time fillet + Catmull-Rom pass whose samples are the truth
  (`:5143`, `:5215`), and **the ring itself** — a plain circle at
  `RING_RADIUS` (`:259-274`) with no rail term at all.
- `computeCrossings` runs **after** `buildPaths`, from `Scenery`/`LampPosts`
  via `bridgeKeepout.ts` and from `ParkTrain`'s constructor — never inside
  the router's own loop.
- `selectSpaced` prunes sites (24 m spacing, footprint overlap, warp bans)
  and, in its own comment, "nothing here prefers a site" where the
  network needs one.

**Ruling (Architect, 6 Sep).** This is the crossingSites case with its
first customer, and the fix has the design's shape, not the hill's:

1. **The question moves to commit time and becomes a refusal.** The
   predicate `computeCrossings` already owns (a side *flip* of the drawn
   samples within `TOUCH_DISTANCE`, snapped to a site within
   `SITE_SNAP_TOLERANCE`) is exported **once** from `crossings.ts` and
   asked by the `pathGraph` task on the built graph's *drawn* samples
   **before** `offerPrewarmedPathGraph` publishes it. A foul there is a
   refused decision inside the generator, with the offending edge named,
   and the router takes its next decision. The construction-time throw
   stays as the last-resort invariant and must become unreachable.
   **One function, two askers** — not a second predicate in `paths.ts`.
   *Corrected 6 Sep:* `pathCentreline()` is empty at that moment (filled
   by `buildPaths()` at world-build), so the screen derives the drawn
   samples from the candidate graph through the **same extracted
   curve→samples step** `buildPaths()` uses — a copied divisions formula
   is the disease one level down. Done: `createCrossingScan` /
   `siteForFlip`, with `computeCrossings` refactored onto them;
   `bridgeCandidateAt` (`crossingPlanSolve.ts:269`) already exists. The
   per-producer ladder in point 2 is sized from the screen's transcript
   on 288, not from the list.

   **The transcript (6 Sep), and the ruling it sized:**

   ```
   seed 288: 25 paved routes, 1342 drawn samples scanned, 1 off-site crossing(s)
     FOUL railD 35.1 at (-36.2, 2.8) — no proven bridge site within SITE_SNAP_TOLERANCE
           drawn by route "spur-station-1" (#17, width 2.6, 5 control points,
           (-22.6, 2.8) -> (-37.5, 0.1))
   ```

   **One producer, not six**: a station approach spur (`paths.ts:4060`),
   the class diagnosed above. The other five draw clean on 288. The foul
   lands on **the exact coordinate `crossings.ts:432` throws at during
   construction** — the same foul, caught three systems earlier. That
   identity is the justification for the extraction over a second
   screen: two askers of one function name the same point; two functions
   that resemble each other would not. Control, three legs: fires on 288
   (one foul); silent on six building seeds (canonical, 5, 11, 24, 131,
   326) at zero; samples scanned printed every run, 1224–1455, **never
   zero, exit 2 on a zero scan** rather than a clean report — the leg
   that caught the empty-`pathCentreline()` wiring before it shipped.

   **Ladder ruling (Overseer 6 Sep, Architect concurs):** fix the one
   producer that fouls — station approach spurs get the rail screen the
   routed legs already have — and leave the other five alone. Five
   speculative fixes are five regressions to owe byte-identity for,
   against no measured defect; the commit-time screen is the mechanism
   that catches each of them *when* it fouls, by name. The engineer's
   caveat stands and is binding on the record: **one seed's transcript is
   one seed's evidence** — the connector leads, lattice-snap jogs, fillet
   pass and ring were *observed clean on 288*, not audited and cleared,
   and remain listed above as producers that do not ask the railway.
   `pathDivisions` / `sampleCurve` are shared by `buildPaths()` and
   `drawnSamplesFor(routes)`; no copied divisions formula.

   **Amended (6 Sep, after the one-producer fix measured as a no-op):**
   screening `spur-station-1`'s appended points with `segmentHoldsRailSide`
   and bending them left **1342 samples before and after, the same foul
   at the same coordinate — the bend never fired.** `segmentHoldsRailSide`
   walks the straight segments between control points; what is drawn is
   a Catmull-Rom through them, and it bulges. The control polyline held
   its side while the drawn curve crossed. So the fault is not in one
   producer's tail; **it is in every rail-side question `paths.ts` asks
   of the control polyline** — the six producers above *and* the legal
   crosser's own `enforceRailSide`, whose comment at `paths.ts:1272`
   already names the curve hazard. The ladder as first written, in
   polyline terms, would have manufactured five more plausible no-ops.

   **Ruling, restated one level down — the one-function rule applies to
   the geometry, not only to the predicate:**

   - **A rung is: change a decision → resample the affected routes
     through the shared `sampleCurve` → ask the same drawn-sample
     predicate.** A rung whose test is on control points is not a rung.
     The question is always "does the *drawn* curve flip sides off-site",
     asked at the point of decision, of the geometry a child will walk.
   - **Polyline tests survive only as pre-filters that may reject, never
     accept.** `segmentHoldsRailSide` / `enforceRailSide` can cheaply throw
     out a candidate whose control points already cross; they can never
     pass one. Commit is the drawn predicate, full stop.
   - **The "next decision" per producer is therefore stated as what
     changes the curve**, and re-measured: extra control points pinning
     the curve (a Catmull-Rom cannot bulge past a point it must pass
     through), a straightened run, a re-route to the next site, an
     on-demand site where the curve actually crosses (`bridgeCandidateAt`
     at the *drawn* rail distance, not the polyline's), and the ring's
     32-bearing sample density is a decision of the same kind.
   - The mechanism the engineer is building is exactly this: the exported
     drawn-sample predicate asked in the router at the point of decision,
     with `createCrossingScan` / `siteForFlip` / the screen in a module
     depending only on `TrainRoute` and `CROSSING_SITES` (no
     `crossings → pathGraph → paths` cycle) and `pathDivisions` /
     `sampleCurve` beside `routeCurve` — one sampling for `buildPaths()`,
     the screen and the router.
   - **The no-op is committed, labelled insufficient, with its negative
     result** — deliberately: the polyline test was tried, here is why it
     cannot work. A reader who removes that commit as dead code has
     removed the evidence.

   The measurement discipline that caught it is the design's own: the
   sample count printed every run. "1342 → 1342" is what said the
   geometry had not moved; a screen that printed only "1 foul" would have
   let a no-op read as a partial fix.

   **Point 1 landed (6 Sep): detection at the point of decision.**
   `crossingPredicate.ts` depends only on `TrainRoute` and
   `CROSSING_SITES`, so the router asks it without the
   `crossings → pathGraph → paths` cycle; `pathDivisions` / `curvePoints`
   sit beside `routeCurve` with one owner. On 288: `station-0 holds=true`,
   `station-1 holds=false` at the foul. Two findings for the record:
   the bend to the approach *also* fouls, so recovery is the whole of
   what remains; and **the screen at first measured a candidate nobody
   lays** — when `leadPlan` is null the committed route is
   `fallbackSpurRoute`, while the screened candidate was
   `[stationLead, approach, stand]`, and station-0 takes exactly that
   path. Found by instrumenting, not reading, inside the fix for screens
   that measure what they do not describe. So the rung definition gains
   a clause: **screen the route that will actually be committed**, never
   the candidate under consideration when the two differ.

   **The recovery contract (Architect, 6 Sep) — asked for because
   "claim a site on demand" as first written mutates `CROSSING_SITES`
   after `crossingPlanSolve` has run and collides with `bridgeKeepout`'s
   memoised `footprints()`.** That is cache invalidation across two
   generators, and the design's answer is to make it impossible to need:

   1. **Sites are candidates until a path uses them, and the site solve
      is a pure function of a demand set.** `solveCrossingSites` (and the
      generator's `crossingSitesSearch`) take `demands: readonly number[]`
      — rail distances the network needs a crossing at — and return the
      site list. Inside, each demanded distance is proven **first** with
      `bridgeCandidateAt(d)` (the existing query, `crossingPlanSolve.ts:269`)
      and force-kept; `selectSpaced` then spaces the remaining candidates
      around the kept ones by its existing rule. **One function** — a
      demanded site is not a bypass of spacing/footprint/warp rules, it is
      a must-keep input to the same selection.
   2. **What is asked, and at what distance**: the *drawn* rail distance
      of the foul — `siteForFlip`'s `d`, the router's own measurement of
      the curve — never the control polyline's. Rounding two demands that
      fall within `SITE_SPACING` of each other into one demand is the
      solve's business, not the router's.
   3. **The loop lives with the path solve and converges**: solve paths
      against `sites(demands)` (initially ∅) → screen the *committed*
      routes' drawn samples → for each foul, `demands ∪= {d}` → re-solve
      sites → re-solve paths → repeat until no foul or the demand set
      stops changing. **Bound derived, not typed**: two demands within
      `SITE_SPACING` are one, so iterations ≤ `loopLength / SITE_SPACING`;
      reaching it is a loud failure naming the seed and the fouls.
   4. **When `bridgeCandidateAt(d)` cannot prove a site**, the demand is
      recorded unservable and the fouling route's next decision is a
      **re-route to an existing site** with the rail corridor at `d` a
      hard obstacle *in the drawn predicate* (the router re-asks the same
      function after re-sampling); if that fails, loud failure. Never a
      warp field, never a widened tolerance, never a silent keep.
   5. **`CROSSING_SITES` is published exactly once, from the converged
      loop, before any consumer reads it** — through the existing prewarm
      letterbox (`offerPrewarmedCrossingSites`) filled *after* convergence
      in the generator, and by the same converged solve in the Node
      harness. Whether `paths.ts` owns the loop and `crossingPlan.ts`
      reads its result, or the `crossingSites` task re-runs on the
      `pathGraph` task's demands, is the engineer's wiring choice; what is
      **not** a choice is that no module-load read of the site list may
      happen before convergence.
   6. **The memo is not invalidated; it is made impossible to compute
      early.** `bridgeKeepout.footprints()` asserts the path graph is
      published (the converged sites are final) and **throws** if asked
      before — an invariant, not a cache protocol. A second definition of
      freshness beside the registry's own is exactly what the
      crossingSites section above forbids; this is the same rule with the
      roles named.
   7. **Order-independence**: the demand set is a function of (seed,
      train route, stations, candidates) computed inside one solve. No
      mutable module-level list, no read whose answer depends on which
      module happened to load first. Proof: two builds per seed in
      separate processes, identical; and the six clean seeds — whose
      demand set is ∅ — **byte-identical** before and after (the digest
      instrument), since an empty demand set must reproduce today's
      `selectSpaced` exactly.
   8. **Reported every run on stderr**: demands per seed with their `d`
      and coordinates, sites proven on demand, unservable demands,
      iterations to converge — the crossing negotiation's first thrash
      numbers, and the line that says "0 demands" on seeds where nothing
      happened so a silent loop cannot read as a working one.

   **Pool-wide (6 Sep): two seeds foul, not one.** Screened across all
   sixteen — seed 267: 1252 samples, 1 off-site at railD 213.4
   (36.9, 6.5), producer being attributed; seed 288: 1342 samples, 1
   off-site at railD 35.1, `spur-station-1`; the other fourteen 0 at
   1172–1574 samples. "Only 288 is red" had been true of `test:procgen`'s
   **seven** seed files and false of the **sixteen**-seed pool — issue
   #579, `check`/`test:procgen`/`build` all green while a pool park is
   broken, which caught two agents in one night. Consequence: on the
   sphere branch `check:coplanar` cannot go green until this recovery
   exists, because it cannot build two of the parks it sweeps — so #511
   is gated on this contract, and step 2 behind it.

   **The contract does not depend on which producer fouls**, and that is
   settled before 267 is attributed: the loop screens the *committed
   routes' drawn samples* whoever drew them, and its rungs — demand a
   site at the drawn `d`, else re-route that route — never ask what kind
   of route it is. A second producer adds no rung. It adds one
   obligation, binding now: **every producer exposes a re-route decision
   to the second rung** (a spur re-plans its street route with the
   corridor at `d` hard; a connector likewise; a snapped run un-snaps or
   re-pins), and **a producer with no route decision — the ring is a
   fixed circle — has the on-demand site as its only rung**, so an
   unprovable demand on it is a *named failure*, never a fall-through
   that keeps the fouling route. The screen names the route; the route's
   producer owns what "re-route" means for it; the loop owns the order.

   This is the crossingSites section made concrete: the march is
   exploration (candidates), a site is claimed when a real path×rail
   conflict demands it, and staleness is handled by re-solving the pure
   function rather than by editing a published list. Stage 4 will move
   the same loop onto the registry (a demand becomes a `Demand` claim,
   `CROSSING_SITES` becomes claims of kind `surface` at crossings); the
   loop's shape does not change when it does.
2. **"Next decision" per producer**, in order of cheapness:
   - an unscreened appendage (spur lead/past, station approach,
     connector lead, snap jog) is a producer drawing without asking the
     world — the disease itself. It gets the same screen the leg has
     (`railInfoAt` / `segmentHoldsRailSide`), and is shortened or bent
     until it holds its side;
   - a routed leg whose drawn curve slips across takes the next site
     candidate, then re-routes;
   - the ring, or a leg with no site within reach, **asks the march for a
     site on demand at that rail distance** — `bridgeCandidateAt(d)`
     exists and is exactly the exploration query; a site proven there is
     added (sites are candidates, claimed when a conflict needs them —
     the crossingSites section above, now load-bearing). If none can be
     proven, the ring segment or leg re-routes; if nothing serves, the
     failure is loud, names the seed and the edge, and is a *test
     failure* (#524), never a skip.
3. **Forbidden**: widening 5.9 (the cruiser's own clearance), widening
   `SITE_SNAP_TOLERANCE` or `TOUCH_DISTANCE`, dropping seed 288 (the
   messenger), and any new warp field — `banCrossingsAt` bans sites; a
   field that *adds* one is the same disease with the sign flipped.
4. **Proved red twice**: on seed 288 on the sphere branch (already red),
   and by a deliberate break on `main` that the fix's refusal path must
   catch — move one canonical site by more than 8 m along the loop and
   watch the router refuse and re-route rather than the build throw.

**Priority against stage 3**: this blocks #511, which is Jim's ruling and
gates step 2; steps 3–4 cannot start before step 2. So it is **ahead of
everything in stage 3 after #528's QA**, and dispatchable now — by the
#511 Engineer, who holds the red seed and the falsification rig, as its
own PR based on the sphere branch so it is reviewable alone. Brief:
`docs/BRIEF-stage4-pre-crossing-refusal.md`. Stage-4 work brought
forward, recorded as such; the registry is not required for it and must
not be smuggled in.

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
builds within budget* — `check:every-seed-builds`, specified under
"Totality, ruled and mechanised" above.

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
| plots | `parkLayout.ts` | `PARK_LAYOUT` circles, re-derived by hand in every consumer (`boundingRadius + x` arithmetic in slide, flowers, coaster…); **and the per-seed `layout`/`layoutRestart` warp fields (#474)** | footprint per plot; consumers stop doing plot arithmetic at all; the layout warp fields deleted, pool green |
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
  self-overlap; junctions merged, never aprons; zero level crossings
  (**shipped as #474, 4 Sep** — the level-crossing tier is deleted end to
  end and a crossing with no proven site or no built deck throws; the
  hard tier inherits that as a rule already true of every pool seed, not a
  goal); nothing overlaps a walkable-must-remain; **elevated
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
