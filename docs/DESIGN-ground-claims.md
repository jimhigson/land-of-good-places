# One owner of the ground

**A design memo for a decision, 3 September 2026.**

Not a plan to start work. A costed proposal so you can say yes, no, or not yet.

---

## The decision

Every part of the park that puts something on the ground — the paths, the
fences, the bridges, the rail race, the boundary wall, the lamps, the trees —
keeps **its own private list of what to avoid**, and they run one after another
in a fixed order. Nobody asks the park what is already there. Everybody asks
their own list.

That is the cause of nearly every layout bug found in the last two days, and
it is why the park only builds about **one seed in thirty**.

You are choosing between four things:

| | What you get | What it costs | When it's right |
|---|---|---|---|
| **A. Do nothing** | Bugs fixed one at a time, as children find them | ~1 agent permanently, forever. The backlog of this exact bug is **23 open issues** and growing faster than it is cleared | If the park is nearly finished and you want to stop |
| **B. More checks** | Each new bug gets an invariant so it can't come back | Cheap per bug (~half a day). But a check finds a broken park; it does not build a good one. The **1-in-30 build rate gets worse**, because every check rejects more seeds | If you only want to protect what works today |
| **C. Fewer parks** | Lock the layout down so fewer arrangements exist | Cheapest of all. **Costs Eleri the varied park** — this is the one option that makes the game worse | Never, on your stated rules |
| **D. One owner of the ground** *(recommended)* | Placers ask the park, not a list. The whole class of bug stops being possible | **~3–4 agent-weeks across 5 stages**, each shippable on its own. Parks change — the sixteen seeds must be re-vetted, twice | Now, because it gets cheaper the earlier it is done |

**Recommendation: D**, taken in stages, with a decision point after stage 2
where you can stop and still have banked most of the value.

**The one thing most likely to make it fail:** stages 3–5 change where things
stand, so the sixteen vetted seeds stop being vetted. If re-vetting is not
budgeted as part of the work, the change lands and the park quietly gets worse
on seeds nobody re-checked.

---

## Why this is worth funding

Three numbers, all measured, none estimated.

**One seed in thirty builds.** Vetting seeds 1–1400 tried 515 and kept 17.
Of the 498 rejected, about 100 stranded a waypoint where no child fits and
about 96 could not grow a railway loop at all — roughly **40% of all
rejections are one system standing on ground another needed**. The sixteen
seeds Eleri can be given exist because 484 others were broken.

**Twenty-three open issues are the same bug.** Not similar — the same shape.
#319, #488, #481, #349, #433, #392, #313, #428, #442, #443, #210, #235, #233,
#207, #206, #193, #325, #412, #466, #300, #396, #432, #437. Plus six more
found in the last two days that are not even filed yet, sitting in commit
messages on two unmerged branches.

**Six backtrack mechanisms doing one job.** The engineer on the path branch
counted them: a foot-join ladder, a gate ladder, an arrival ladder, a relay
rescue router, a grid-discipline ladder, and exemption-by-identity in three
separate places. Each was a reasonable fix. Together they are the cost of not
having done this.

His summary, unprompted, after a day inside it:

> *"the bridge planner picks its sites without knowing where the fountain is;
> the path grid finds out much later that it can't reach the foot. That's the
> shape of nearly everything on this branch — one system decides, another
> discovers the consequence, and an agent spends a session bridging the two.
> It's slow going, and I don't think more of it gets you the park you asked
> for."*

---

## He said there are seven models of the ground. I counted. There are ten.

He was right, and it is worse than he said. Ten separate answers to "what is
on this ground?", none of which is the authority:

1. **`CollisionWorld`** — what the player bumps into. Built up as the world
   builds, so it is only complete at the very end.
2. **`BLOCKERS`** in `paths.ts` — a hand-built array of plot discs and rail
   race arch feet, and nothing else.
3. **`PARK_LAYOUT`** — the plot list, frozen before anything else runs.
4. **The lattice** — `paths.ts`'s grid of nodes and `edgeOk` edges.
5. **The path graph** — `pathGraph.ts`'s `isOnPath` / `distanceToPath`, a
   *different* representation of the same paths.
6. **The crossing plan** — `crossingPlanSolve.ts`, where the railway may be
   crossed.
7. **Bridge site reservations** — `SITE_HALF_WIDTH`, a rectangle nothing
   builds anything the shape of.
8. **`NavGrid`** — where the player may walk at runtime.
9. **`keepOutsFor`** — the castle's own separate keep-out list.
10. **`PlacementField`** in `coSolve.ts` — a proper shared field, built and
    unit-tested last month, **and wired into nothing**.

Every bug of the last two days is two of those ten disagreeing.

### And the bugs are not quite what they look like

Two corrections worth having before deciding, because they change what the fix
has to be.

**The cat bus is not a missing list entry.** The obvious diagnosis is that the
entrance road is missing from `groundIsClear` in `railRace/track.ts`. But that
function *does* ask the real world — its first line is
`collision.isClearCircle(x, z, 1.1)`. It asks correctly and gets a truthful
answer. The road is not in it, because `World.ts` builds the rail race at line
214 and the entrance at line 268. **It asked a world that did not exist yet.**
Adding the road to a list would fix this one instance and teach us the wrong
lesson. The problem is the ordering, and no list is deep enough to fix an
ordering problem.

**The bridge reservation is already against the rules.** Decision 6 says
nothing reserves space. `SITE_HALF_WIDTH = 5` reserves space. Measured on four
sites across three seeds, the reserved band sits **1.1–2.3 m outside the
outermost real stone**, and the actual masonry — `|across|` 1.1 to 2.7 — is
inside what the reservation calls free road, so **the real stone is not
screened at all**. Both errors at once: it refuses doors where there is
nothing, and permits stone where a path was never kept off. On 16 seeds, 28 of
30 built decks fit inside 2.52 m against a reservation of 4.5–5.5 m.

That is not a bug in the bridge planner. It is what a placer has to do when it
must state its footprint before the thing that decides its width exists.

---

## What is actually proposed

**One registry. Placers ask it. Nobody keeps a private list.**

Concretely, four things, and the third is the one that makes it work.

### 1. There is one thing you ask, and it answers about the whole park

A placer says *"may I put this here?"* and gets yes or no. It never names an
obstacle type. It cannot miss a kind of thing, because it is not enumerating
kinds of thing. `PlacementField` in `coSolve.ts` is 80% of this already; it
needs to hold more than discs.

### 2. There are four kinds of claim, not one

Today everything is a keep-out disc. That is why a path may not cross a bridge
deck — the two kinds of claim that must coexist look identical to the code.

- **Footprint** — solid stuff. Stone, trunks, walls. Nothing else may overlap.
- **Corridor** — a thing that travels. Track, road, path ribbon. Crossings are
  legal at declared points and nowhere else.
- **Walkable-must-remain** — a doorway, a stand spot, a seat, a ride exit.
  **This is the one that is missing today**, and it is why the boundary wall
  closed the gate on nine seeds and a lamp stood inside the arch on two. There
  is no way, right now, to say "a child has to be able to stand here" that
  anything is obliged to hear. `keepOutsFor` is the nearest thing and only the
  castle uses it.
- **Surface** — a bridge deck, a mall plate. Solid from below, walkable on
  top, and a path is *welcome* to cross it. Decision 8 already established
  this shape with `covers(x, z)`.

The rules between them are a small fixed table — a path may cross a surface, a
fence may not cross a path, nothing may overlap a walkable-must-remain — not
per-placer knowledge.

### 3. A claim can be provisional, then made real

This is the answer to the ordering problem, and it is the whole reason the
bridge case is unfixable today.

A bridge is built as wide as the path that crosses it. Its real footprint
cannot be known before paths exist. So today it guesses, guesses badly, and
the guess is wrong in both directions at once.

Instead: a placer may claim **provisionally** — "something of mine will be
here, I don't yet know its exact shape". Provisional claims block nothing on
their own; they are a note to the search that this ground is contested. Later,
the placer **realises** the claim with its true geometry. If the true geometry
does not fit what has since been committed around it, that is a normal
conflict and normal backtracking handles it.

This replaces `SITE_HALF_WIDTH` with the actual stone, which is both more
permissive (stops refusing doors that fit) and stricter (stops masonry landing
on unscreened ground). Both live bugs, one mechanism.

### 4. Backtracking means asking a neighbour to move

Against a list, "backtrack" can only mean *try somewhere else myself* — a
placer cannot ask a plot to shift, because the plot was frozen before it
started. That is why there are six backtrack ladders: each is a different
placer working around the fact that it cannot ask.

Against the registry, a refused claim returns **who refused it**. The placer
may retry elsewhere, or hand back "I am stuck, and it was the fountain" — and
the fountain gets withdrawn and re-placed. `CoSolveEngine` already does
exactly this, including the `blockers` hint, with ten unit tests. It has never
been switched on.

This is not new policy. It is **Decision 12**, ruled on 11 August, substrate
built, stages 2–4 never started. Much of what this memo proposes is finishing
a decision already made.

### This does not break "nothing reserves space"

Decision 6 is the rule most likely to be thought violated here, so plainly: a
claim in this design is **a publication of what a placer actually solved**, not
a request for room it might want. That is precisely what Decision 6 asks for —
*"a system publishes what it actually solved, and everything else treats that
as an obstacle."* The registry is the missing place to publish it to.

The one apparent exception is the provisional claim, and it is not one: a
provisional claim reserves nothing and refuses nobody. It only tells the search
that ground is contested, so that the contest is resolved by backtracking
rather than discovered afterwards by an agent with a transect script.

If anything, this design **removes** the reservations we have. `SITE_HALF_WIDTH`
and the rail race's hand-tuned clearances are reservations in the sense Decision 6
forbids, and both go.

---

## How it lands, in stages

Each stage ships on its own and is judged by `check:park` + `test:procgen`.
**Stop after any stage and you keep everything up to it.**

### Stage 1 — the registry exists, and the tests are its first customer (small)

Widen `PlacementField` to the four claim kinds. Then make
`test/procgen/parkFacts.ts` read from it.

This stage is deliberately backwards, and it is the cheapest insurance in the
plan. `ParkFacts` is **56 fields and 2,636 lines** of hand-extracted "what is
in this park" — the project has already built this registry once, for the
tests, in a form the generator cannot use. If the registry can feed the
existing ~80 invariants unchanged, it is complete enough to be believed. If it
cannot, we find out for the price of one stage instead of five.

**Nothing about the park changes. No seed re-vetting.** Purely invisible.

**Risk:** `ParkFacts` measures the *built scene* — real vertices, real meshes.
The registry holds what was *claimed*. Where those disagree the registry is
wrong, and this stage is what surfaces it. Expect a week, not a day.

### Stage 2 — one placer pair proves the idea (small)

Take **the entrance road and the rail race trestles** — issue #488, measured on
all 16 seeds, worst intrusion 2.51 m, and with a proof already written that no
road outset clears the legs.

The road publishes a corridor claim. The trestle search asks the registry
instead of `groundIsClear`'s four predicates. Because the ask is now against a
registry rather than a half-built collision world, the ordering problem
disappears — which is the actual bug.

This pair is chosen because the fix is already in flight on `fix/road-487-488`
and can be compared against directly: same bug, two ways, measured.

**Decision point.** If stage 2 does not clearly beat the hand-written fix on
those 16 seeds, stop here. You have lost about a week and gained a registry the
tests use.

**Risk:** low. One pair, one issue, an existing fix to measure against.

### Stage 3 — the bridge's guess becomes a real claim (medium)

`SITE_HALF_WIDTH` goes. A bridge site claims provisionally; the built spine
realises it. Kills issues #319, #349, #433, and the two undocketed findings
about masonry on unscreened ground.

**This is the first stage where parks move.** Paths that were refused by a
phantom 5 m reservation will now be drawn. Expect the sixteen seeds to need
re-vetting, and expect some to fail.

**Risk:** medium-high, and this is the stage to watch. Measured already: taking
the reservation to zero fixed seed 11 (22 stranded → 2) and broke seed 5
(10 → 13, with `route.unreachable: 5`). Better information will probably fix
that, but "probably" is the honest word.

### Stage 4 — the walkable-must-remain claim (medium)

Doorways, stand spots, seats and ride exits become claims nothing may overlap.
Kills #481, #483, #233, #412, and the lamp-in-the-arch class permanently.

This is the stage CLAUDE.md's existing rule most wants — *"`keepOutsFor` is the
single owner of where a child has to be able to stand"* — made true for the
whole park rather than the castle.

**Risk:** medium. Some things currently placed will have nowhere to go, and the
right answer is usually to skip them (PR #485 already establishes the
precedent: "a lamp which does not fit is skipped rather than forced"). The
failure mode to watch is a park that quietly loses furniture.

### Stage 5 — the layout joins the search (large)

Decision 12 stages 2–4, unchanged from what was already ruled: plots and rides
co-solve, `PLAZA_INNER_FLOOR` and the other hand-holds come out, and the six
backtrack ladders collapse into one.

**This is where the 1-in-30 build rate should move**, because it is the first
point at which a stuck placer can ask a plot to shift.

**Risk:** high, and it is the stage that could be dropped. Every park changes.
`check:park-boot`'s "sliced equals straight-through" proof must be
re-established. Budget re-vetting the whole pool from scratch.

---

## What is irreversible

Only one thing, and it was already accepted when Decision 12 was ruled: after
stage 5, **editing one entry in the manifest can move another**. Issue #241's
locality — "editing one entry cannot move another" — is deliberately traded
away, because the whole point is that a railway can make a stall step aside.

Everything before stage 5 is revertible. Stages 1 and 2 are invisible to a
player and can be abandoned at no cost beyond the time.

---

## What this does not fix

Said plainly, because a design that fixes everything gets believed once.

- **It does not make the park nice.** The pool notes already say this about
  vetting and it is just as true here: nothing in a registry knows the ice
  cream is a long dull walk from the gate, or that every stall clumped on one
  side. This raises the floor. It does not raise the ceiling.
- **It does not fix the vertical.** The rail solvers search in plan view only
  (Decision 6 §3) and this changes none of that. The Sky Cruiser hitting the
  fairy lights (#210) and the grown-up standing 7.9 m in the air on the mall
  plate (#412) are height problems. A 3D search is separate work, not smuggled
  in here.
- **It does not fix the quality failures that reject seeds.** Of the seeds
  rejected during vetting, the duck bar slowing the ride (95), the race camera
  running backwards (94), and the cruiser missing the castle (73) are not
  ground conflicts. **Roughly 40% of rejections are in scope, not all of them.**
  Do not expect 1-in-30 to become 1-in-1.
- **It does not remove a single invariant, and must not.** The invariants are
  how all of this was found. The registry should make perhaps a dozen of the
  ~80 true by construction — the pairwise "X clears Y" ones like
  `treesKeepOffWalls`, `lampsTouchNothing`, `plotsDoNotOverlap`. Those stay in
  the suite anyway as a check on the registry itself. A check that a mechanism
  makes impossible is exactly the check you want kept, because it is the one
  that will tell you when the mechanism breaks.
- **It does not fix anything at runtime.** `CollisionWorld` and `NavGrid` stay
  as they are. This is about generation only. A prop with no collider is still
  a prop with no collider.
- **It will not eliminate all six backtrack ladders.** It should collapse most
  of them, but some encode genuine per-placer knowledge that has to live
  somewhere. Assume three go and three get simpler.
- **Stage 5 might not be worth it.** Stages 1–4 are the ones with named issues
  attached. Stage 5 is the one with the big number on it and the least
  evidence. It is fine to fund 1–4 and rule on 5 later.

---

## The alternatives, fairly

**A. Do nothing; fix instances.** This is the current policy and it is not
absurd — every fix so far has been correct, and the park does work on sixteen
seeds. The cost is that the backlog of this class is growing faster than it is
cleared (23 open, 6 more found in two days, none of them closed in that time),
and each fix adds a mechanism the next agent has to understand. Right if the
park is close to finished.

**B. Keep the approach, add invariants.** Cheap, and it is the honest reading of
CLAUDE.md's existing rules. But an invariant is a detector, not a fix — it
converts a bug a child finds into a seed that will not build. With a 1-in-30
build rate, **more checks make the pool harder to fill**, and the seed pool
notes already record three routing changes invalidating a whole vetting run.
Right if you want to protect what works and stop adding to the park.

**C. Reduce the variation.** Fewer configurations, fewer conflicts. The
cheapest option by a distance and it would genuinely work. It is also the only
option on this page that makes the game worse for Eleri, and your rule is that
the park stays generated and varied. **Recommended against, on your own
constraint, not on engineering grounds.**

**D. Stricter ordering, each placer publishing its output.** The near miss, and
worth naming because it will be proposed. Keep the fixed sequence, but make
each placer publish what it built so later ones read it instead of a list.
Cheaper than the registry and fixes the cat bus. It does **not** fix the
bridge, because no ordering exists in which a bridge knows its width before
paths and paths know the bridge before it is built — that is a cycle, and a
sequence cannot contain a cycle. It also cannot fix the fountain severing the
lattice, for the same reason. Right as a fallback if the full design is refused.

---

## What I would do

Fund **stages 1 and 2**. Two weeks, invisible to a player, decidable at the end
on a measured comparison against a fix that already exists.

Rule on stages 3 and 4 after seeing that. Leave stage 5 open — it is
Decision 12, it is already ruled, and it will still be there.

---

### Sources

`CLAUDE.md`; `ARCHITECTURE.md`; `ARCHITECTURE-DECISIONS.md` Decisions 5, 6, 7,
8, 9, 10, 12; `ORDER-OF-WORK.md`; `GAME_DESIGN.md`; `test/procgen/invariants.ts`
(~80 invariants); `test/procgen/parkFacts.ts`; `src/boot/coSolve.ts`;
`src/boot/parkGeneration.ts`; `src/world/paths.ts`; `src/world/Scenery.ts`;
`src/world/railRace/track.ts`; `src/world/parkSeedPool.ts`; issues #488, #481,
#319, #349, #433, #392, #313, #442, #443, #210, #235, #233, #207, #206, #193,
#325, #412, #466, #300, #396, #432, #437, #428; PR #485; branches
`feat/grid-paths` and `fix/road-487-488` with their handoff files.
