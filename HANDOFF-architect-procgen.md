# HANDOFF — Architect, procgen rework (round-robin generation)

**This agent runs Fable (`claude-fable-5`), chosen by Jim** — per CLAUDE.md, a
replacement runs the same model. Role: Architect. Branch
`design/round-robin-generation`, worktree `.claude/worktrees/design-round-robin`.
Report to the coordinator, never directly to Jim. Do not merge anything.

**The authority is `docs/DESIGN-round-robin-generation.md` on this branch** —
ruled by Jim in conversation, 3 Sep. Stages 1–2 (GroundClaims registry +
SolveScheduler spine, byte-identical parks) merged as #499. The universal
overlap invariant is in flight on `feat/universal-overlap-invariant` (its
first honest run found #501).

## COLD PICKUP — read this first (written 7 Sep 2026, on Jim's pause)

**Work is paused by Jim** (token spend) except the spherical-earth and
arrival-camera stream. Do not start anything until an Overseer un-pauses.

- **Model: Fable, by Jim's standing instruction** for this whole procgen
  workstream. A replacement Architect runs Fable. So does the step-2
  engineer.
- **Branch**: `design/round-robin-generation` — the authority is
  `docs/DESIGN-round-robin-generation.md` there. As of this commit it is
  **current with `main`** (dd5b3b6b; `git rev-list --count HEAD..origin/main`
  = 0). Work in your own worktree, never the shared checkout.
- **Step 2 (trestles become claims) is APPROVED at `a06178a4`** on
  `feat/procgen-step2-trestles-claim`, reviewed by measurement on a
  detached worktree at every sha. **One item outstanding**: the duck-bar
  fairness clause re-cut, ruled at `064e834b` (design doc, "Fairness is
  the race ring's property") — equal-per-racer on the race ring only;
  the walk-past ring's lane counts equal the race ring's minus road-rule
  skips, printed. When it lands: clause green on the canonical seed,
  proved red by dropping one race-ring bar, `test:procgen` 706/706 on the
  sphere merge. The PR cannot open green until the sphere (#511,
  `feat/sphere-combined`) reaches the design branch; on the hill the
  road runs along the ring and the rule costs 60–70 m spans — hill-only.
- **Step 3's brief is implementable as written**
  (`docs/BRIEF-stage3-step3-confront-ladder.md`): the trestles become a
  scheduler task, the road takes two real turns (`publishPaving()` moves
  into the `pathGraph` task — the one stage-4 item brought forward),
  interleaving proved by the task-turn log, the decision-stream owner
  lands. It touches the road files the sphere engineer is live in, so it
  waits for the sphere and for step 2.
- **Step 4 is HELD with NO CUSTOMER — deliberately, not by omission.**
  Jim's road rule ("just skip all the legs over the road, otherwise keep
  them") means a trestle refused by the road is skipped, never
  negotiated, and the road is never refused by a trestle. There is
  nothing for the pair to negotiate, so **do not build the scheduler's
  retry/negotiate/unwind ladder for it** — that would be a mechanism
  exercised by a check that cannot fail. It lands with the first placer
  that genuinely returns a refusal a blocker can clear (stage 4's paths).

### Two facts that are load-bearing in more than one place

1. **The two rail-race rings are never in the world at the same time.**
   Jim: *"either the small one or the big one is shown — it is purely a
   visual trick."* In code: `RailRace.setActiveRing` (the one place).
   Two rulings rest on it and on nothing else: both rings claim as ONE
   feature `railRace` (they never constrain each other; the walk-past
   colliders register after both are placed and stay, because walkers,
   `NavGrid`, `LampPosts` and `check:park` read them), and the road
   rule's asymmetry (the ride-scale ring keeps every leg; the walk-past
   ring skips its own over the road). **If that fact were ever false,
   both are wrong together.**
2. **The seed pool shrinks while the generator is being replaced** (Jim's
   ruling): a seed that fails the *old* generator is retired, never fixed
   — #589 retired 267 and 288; #584 (open) makes the pool 0..15. Under
   totality the pool survives only as quality curation; do not spend
   engineering on making the old generator pass a seed.

### Corrections made tonight — the kind that come back

- **The 6.15 m bus roof was a `Box3` artefact, not a vertex**:
  `Box3.setFromObject` without `precise` transforms each part's box, and
  a cone tilted 0.22 rad lifts its box by radius·sin(tilt). The drawn top
  is the face sphere's crown at **6.0429 m**; `CAT_BUS_TOP` derives from
  it and `check:swept-bus` asserts owner == vertex-precise top at 1 mm.
  The driven top is **6.4991 m** (heave + nose-up pitch, roll contributes
  nothing at the crown — measured by posing the mesh; the linear
  `roll·FACE_RADIUS` term over-stated it by 0.10 m). A derived number
  nobody compares to the mesh is the two-definitions disease.
- **My 93→92 walk-past leg count was measured on the branch tip alone
  (hill geometry), not the park that ships**; on the sphere merge the
  rings are identical. Never report a number without its base.
- **"The road rule fires on zero slots on the sphere" was reasoned from
  the road's outset, not measured, and was wrong**: the road runs
  radially into the gate and crosses the band there — one walk-past slot
  on six pool seeds. The engineer's measurement was the true one.
- Filed, not fixed: `CAT_BUS_WIDTH` 5.28 m vs a drawn body 7.30 m wide
  (`theRoadClaimCoversTheBusRun` samples a run narrower than the bus).

### Where things are

- Design doc sections ruled tonight: "Steps 3 and 4, re-cut (6 Sep)",
  "One rail race (Jim, 6 Sep)", "The road rule (Jim, 6 Sep)" with "Final
  form" and "Fairness is the race ring's property".
- Step-2 engineer's handoff: `HANDOFF-procgen-step2.md` on its branch
  (merge recipe for the sphere; the checkout-discards-edit trap).
- Open PRs on the design branch: none from me. #584 (pool 0..15) open on
  `main`, red by design until the generator builds 0..15.
- The checkpoints below are the night's record, oldest first; the
  earlier "State at a glance" they refer to is superseded by this section.

## Checkpoint, 5 Sep — #474 and #498 read against the design

- Merged main (rebase replayed 31 commits into an add/add on the doc;
  merge instead, as before). #474 touched none of the pair's files; doc
  gained a warp-vectors section and "zero level crossings" marked shipped.
- First re-cut said "the ring re-routes" — **wrong**, struck the same
  hour: `railRace/route.ts` is the perimeter circle by the family's brief,
  nothing to steer. Lesson recorded in the doc: check whether a decision
  is generator-owned before prescribing backtracking over it.
- Also found: `GroundClaims` has no production instance; `CoSolveEngine`
  is test-only on `PlacementField`. Step 1 now owns creating the instance.

## Checkpoint, 3 Sep — the slide-leg evidence is in the doc

Jim asked why a slide leg lands in the train's path. Judged: **an instance of
the rework, with one genuine design gap**, now closed in the doc. Three doc
changes, all pushed:

1. **Unwind rung widened** — Jim's verbatim ruling recorded: *"All decisions
   can be backtracked or reversed"*, up to and including moving the castle.
   The rung previously said "pop **own** earlier decisions", which was
   narrower than the ruling.
2. **New section "A feature's own supports are claims"** — the gap: the doc
   only spoke of claims *between* features. A feature's derived placements
   (slide legs; trestles; pylons) are claims made interleaved with the parent
   decision in the parent's own turns, so a refused leg backtracks into the
   route while it is cheap to bend. Silent skips ("one that cannot is simply
   skipped") are banned; "elevated structure is supported" joins the hard
   tier.
3. **The evidence is measured, not hypothesised** — `fix/slide-legs-501`
   built the honest within-ticket fix: railway violations 4 → 0, but seed 5's
   slide drops to 2 legs on 83 m (5% of the chute is supportable ground; 55%
   forbidden by paths, 33% by rail). Every within-ticket lever refuted with
   numbers in `HANDOFF-slide-legs-501.md`. Their lever 4, "re-route the
   chute", is exactly what this design produces by construction.

Branch state: merged `origin/main` in (the old rebase conflicts were an
add/add on a doc main already carried byte-identically; a reset was blocked
by permissions, merge used instead). Design-doc-only branch; no code.

## Standing judgements to carry

- **#501 — RULED by the Overseer, 3 Sep** (both per this architect's
  proposal): (5) seed 5 is swapped out of the pool now, by the documented
  process in `parkSeedPool.ts` — vet, replace, record date and commit.
  (4) the slide's re-route is **the slide's migration onto claims**, a
  stage-4/5 item of this design; no bespoke `slide/solve.ts` rescue ladder,
  and **no engineer is pointed at it until the stage lands.**
- Jim has said this workstream is uniquely this agent's, to stay on until
  done.

## Checkpoint — stage 3 specified (3 Sep, in the design doc)

"Stage 3, specified" section added: today's commit points read from merged
code (`RAIL_RACE_PLAN` at module load of an ungated ladder rung; legs at
`RailRace` construction; PR #498's fix is a *named* road-corridor clause in
`railRace/track.ts` — itself the seam stage 3 deletes). Four migration
steps, each a small PR: road becomes a corridor-claiming placer (prewarm
pattern), trestles become footprint-claiming, then confront the ladder
(eager/data-gated module loading; re-run the #499 perturbation experiment
to prove deps went load-bearing), then cross-feature negotiation. Named
substreams must land WITH the ladder step, not after. Acceptance: universal
invariant green pool-wide with the named clause deleted; #498's swept-bus
control stays armed as the independent instrument; zero new code covers the
next neighbour. Sequencing: PR #498 lands first, do not race it.

Next: propose the stage-3 step-1 engineering brief to the coordinator once
PR #498 merges (implementation changes shipped behaviour → proposal first).

## Checkpoint — stage-4 mechanism written (3 Sep)

"Incremental route growth: explore free, commit in sections" added to the
doc, reconciling Jim's section-by-section ruling with `railRouteSearch`'s
whole-route private exploration: reads of the registry are free and
unlimited during search; commitment is turn-based, one section + its extra
geometry per turn; the section is the unit of unwind. Support obligations
reuse the demand mechanism (an unserved support demand fails like an
unserved door demand). Two binding notes: search outcomes may legitimately
change when a sibling claims between turns (budget counters measure the
rate), and the exploration query MUST be the same function as the commit
check — otherwise the two-definitions disease reappears inside one
mechanism. First customer: the slide (ruled).

## Checkpoint — both named design debts closed (3 Sep)

- **Section size is derived, never typed**: one decision of the growing
  search — one `turnVocabulary` segment for everything on the shared
  generator. No `SECTION_LENGTH` constant, ever (typed-not-derived bug
  class). Claims map 1:1 to decisions so backjumping can land on the
  decision a blocker names. Scatter placers may batch; route placers
  commit one segment per turn — coarser commits only via a measured
  proposal back to the doc.
- **crossingSites reclassified as exploration**: the march survives as a
  solver and its prewarm boot-slicing with it, but its sites are
  candidates, not reservations — a site is claimed only when a real
  path×rail conflict consults it, provisionally. Staleness handled by the
  one-function rule (commit refusal catches it), NOT by a cache
  invalidation protocol. General rule set: a computed overview may inform
  decisions; only a claim makes ground yours.

## Checkpoint — contradiction pass done (3 Sep)

Whole doc read as one piece; four staleness fixes, all in pre-tonight
sections, all pushed: (1) lead section no longer claims "stages 2-4 never
started" / "pipeline is strictly sequential" — dated #499 update added;
(2) substrate corrected from "PlacementField is 80%" to groundClaims.ts,
with the four-kinds heading reconciled against the fifth (demands);
(3) stages 1-2 marked landed, planned-vs-shipped stated honestly (stage 1
shipped as a new module, not a widened field; parkFacts-from-registry proof
deferred to the migrations); (4) demands section no longer quality-only —
one mechanism, two tiers of consequence. Also: the epigraph is now at the
top of the doc ("a computed overview may inform any number of decisions,
but only a claim makes ground yours"), per the coordinator's endorsement.
Checked and left alone: provisional-claims vs crossingSites-as-exploration
(reconcilable — a provisional claim is made when a crossing is decided,
which can be an early round; realisation waits for width).

## Checkpoint — stage-5 migration checklist written (3 Sep)

Ten-row per-placer table in the doc, compiled by sweeping `src/world` for
placement-time obstacle queries. Starting evidence from the coordinator:
#503 (Flowers asks paths+cruiser only), #504 (bush claims 0.85 m of a
2.15 m drawn clump), #501 (leg planner, routed to stage 4 by ruling).
The #504 two-definitions variant is binding on every row: footprint claims
describe the DRAWN geometry (one owner), colliders stay their own size —
overlap and solidity are different questions. Order: plots first (everyone
re-derives their circles by hand), scatter placers next, attached
decorations last as verifications. Stage 3/4 items explicitly excluded so
nobody re-files them.

All five stages now have specs or checklists.

## Checkpoint — step-1 brief drafted and held (3 Sep)

`docs/BRIEF-stage3-step1-road-placer.md` on this branch: the full
engineering brief for "the road becomes a placer", written to hand to an
engineer the minute #498 merges. Its own header says commit points must be
re-verified at pickup (#498 was OPEN and **CONFLICTING** when drafted —
flagged to the coordinator). The one-function / claim-IS-the-route rule is
the brief's first section, per the coordinator's ask. Byte-identical step;
#498's clause and checks explicitly out of scope.

## Checkpoint — all four stage-3 briefs drafted and held (3 Sep)

`docs/BRIEF-stage3-step{1,2,3,4}-*.md` on this branch, each with: the
one-function rule as the reviewer's first section, commit points with the
re-verify-at-pickup caveat, an explicit byte-for-byte statement
(steps 1–2 IDENTICAL and proved by hashes; step 3 park-may-change with
substreams landing there and changes countersigned; step 4 change bounded
to conflicted seeds only), and measured acceptance. Step 4 carries the
Overseer's instruction verbatim in spirit: the swept-bus control must be
**watched failing** (clause deleted + negotiation disabled, red transcript
with geometry) before it is trusted as the deleted clause's stand-in —
step 2's redundancy demo explicitly does not count. Also fixed en route:
the spec's "byte-identical until the last" contradicted its own
determinism note; now "byte-identical through step 2".

Hand-out order: step 1 the moment #498 merges (rebased to `7bfcca23`, in
review); each later brief when its predecessor lands. Steps are strictly
sequential — do not parallelise them; the fleet parallelises at stage 5.

Next trigger: #498 merges → step-1 brief to the coordinator as a proposal.
Idle otherwise; coordinator has said they will assign rather than leave
this agent parked.
- Stage 3 remains: migrate the entrance road + rail-race trestles pair, and
  **confront the import ladder** (see `parkGeneration.ts`'s module header —
  the ladder, not the deps, serialises today; four of six deps measured
  inert). One placer per PR.
- Anything changing shipped behaviour goes to the coordinator as a proposal
  before an engineer is put on it. Design work itself is standing authority.

## The one rule to inherit above the others

**The exploration query and the commit check must be the same function.**
A search asking "would this be refused?" during exploration and the claim
running a different check at commit is the two-definitions disease rebuilt
inside the one mechanism designed to kill it — the only legal source of an
explore-yes/commit-no disagreement is a sibling's intervening claim. The
coordinator has singled this rule out; it binds every migration PR and
every cache built over the registry (see the crossingSites decision in the
design doc). If you review a placer migration, look for this first.

## Standing habit: additions rot the older sections

The contradiction pass found all four of its fixes in sections written
*before* that night's six additions — none in the additions themselves.
That is not a one-off (coordinator's observation, adopted as practice):
new sections are written against the current state; old ones quietly stop
being true as stages land and rulings arrive. **After any burst of
additions to the design doc, re-read the older sections against the newest
rule** — especially the epigraph ("only a claim makes ground yours") and
any ✅-landed markers — and date the corrections rather than silently
rewriting history.

## Traps already paid for

- Never pipe checks through `tail`/`head`; TDZ crashes read as passes.
- A constant restating something computable is a bug even while it agrees.
- `rerere` is on: rebuild any `check`-chain conflict resolution from main's
  parsed step list, never accept the replay.

## Checkpoint 6 Sep, ~13:00 — merge of `origin/main` into the design branch

- Worktree `.claude/worktrees/design-merge-main`, branch `arch/design-merge-main`
  (pushed). Merge commit `bf2ff61f` = design `2bc4b51f` + `origin/main`
  `dd5b3b6b` (#588). `check` (64 steps), `test:procgen`, `build`,
  `check:coplanar`, `check:swept-bus`, `check:park-pool` all exit 0 on it;
  **pushed to `design/round-robin-generation` as `753ca8c3`** (6 Sep 20:44).
- **Finding, verified**: `#585` on `main` is a squash of this branch (its
  body is this branch's commit messages). So the merge's only conflicts are
  the three docs this branch edited *after* the squash snapshot
  (`HANDOFF-architect-procgen.md`, `docs/BRIEF-totality-poi-rung.md`,
  `docs/DESIGN-round-robin-generation.md`), and each design copy is a strict
  superset of main's (0 lines removed; 12/11/90 added). Resolved to ours.
  The merged tree differs from `origin/main` by those 124 insertions only —
  no deletions (`git diff --cached --diff-filter=D dd5b3b6b` empty).
- `check` chain: 64 steps, same set on main, design and merged (parsed, not
  grepped). `rerere` had nothing recorded; nothing replayed.
- A predecessor had merged `e080b753` (#585) rather than the tip; that
  in-progress merge was aborted and redone against `dd5b3b6b`.

## Rulings, 6 Sep — step 2's four open questions (asked in `HANDOFF-procgen-step2.md`)

1. **Arc nudges: delete with the radial ladders.** One search over
   (lean, arc), nearest-first, lean-outer / arc-inner as built; the arc bound
   is derived, `TRESTLE_SPACING / 2 − foot radius` (two neighbouring slots
   can then never share ground), never a list. Confirmed as proposed.
2. **Lean limit: `maxLean = tan(BRANCH_ANGLE) × trunkHeight`**, trunk height
   from `forkPlan` (the `MIN_TRUNK_FRACTION` floor), owner
   `trestleGeometry.ts`. Confirmed. A trunk may not lean further from
   vertical than its own branches fork — that is the geometry's statement,
   not a typed reach.
3. **Headroom owner: the drawn bus, and the constant must equal it.**
   `CAT_BUS_TOP` 5.98 m versus a drawn box of 6.15 m is the two-definitions
   disease exactly (a constant asserting it matches a mesh). Anything drawn
   is solid, ears included, so the headroom is the drawn top. Resolution:
   the bus asset's own owner (`catBus.ts` — take the sphere branch's
   `CAT_BUS_BODY_TOP_Y` if it is *derived* from the drawn geometry; if it is
   another typed number, derive it) is what the corridor claim's `headroom`
   reads, and `check:swept-bus` keeps measuring the drawn `Box3`
   **independently** and gains one line asserting the owner equals the
   drawn top within float slack — so the 0.17 m gap can never reopen
   silently. Do not widen the claim by a margin to cover the gap.
4. **The four legacy predicates stay behind the one predicate function,
   registry asked first.** Confirmed, with two conditions: a refusal names
   *which* predicate refused (registry blockers by feature name; a legacy
   predicate by its own name, e.g. `legacy:distanceToPath`), so stage 5 can
   see what is left to migrate from the traces rather than from the code;
   and the count of refusals-by-legacy-predicate is printed to stderr per
   seed as a coverage line, "0 — the registry decided every slot" when so.

Not a ruling, a correction for the record: the placer **throwing** on a
refused duck-bar slot (`track.ts` ~L1552, "refused by …") is the interim
step 2 was allowed — it is loud and names its blockers — but under the
totality ruling a throw on a seed's geometry is the bug; step 4 converts
it to a refusal returned to the scheduler. Step 2 should not spend time
on that conversion, only keep the message carrying the blockers by name.

## Checkpoint 6 Sep, ~21:30 — steps 3 and 4 re-cut to implementable shape

Both briefs rewritten against the code (not the earlier drafts): the
trestles are not a scheduler task after step 2 (step 3 makes one,
`railRaceSupports`); `roadCorridor` is `deps: ['pathGraph']` and its second
turn is a `World` re-commit (step 3 splits it and moves `publishPaving()`
into the `pathGraph` task — the one stage-4 item brought forward); neither
placer draws randomness; step 4 = `SolveScheduler` absorbs `CoSolveEngine`
(deleted with `PlacementField`), tasks return `Refused`, the trestle throw
becomes a refusal, the road's next attempt is derived from the blocker's
extent, scheduler decision zero wired and proved under a scratch flag, the
layout's decision zero named as stage 4's. Design doc: "Steps 3 and 4,
re-cut (6 Sep)". Step 2's four questions ruled (section above).

## Review, 6 Sep night — step 2 at `f92830c1` (branch diff; no PR yet): changes requested

Measured on a detached scratch worktree: `tsc` 0, `typecheck:test` 0,
`check:ground-claims` 0, 45 unit tests green, swept-bus child on the
canonical seed 0/0/0. Ruling 3 verified by measurement: owner 6.0429 m ==
vertex-precise drawn top 6.0429 m (gap 0.0000); `CAT_BUS_TOP` + 1 cm makes
the child throw "off by −0.0100 m". Rulings 1, 2, 4 present as ruled.

**The change**: the corridor's `headroom` is the bus at rest, and the bus
drives with `chassis.position.y = CAT_BUS_RIDE_LIFT + heave` (±0.2 m) and a
nose-up pitch to 0.042 rad; the race ring's fork nodes sit below `beamY`
6.35 m against a 6.04 m rest top, so a branch in that band is allowed by
the claim and hit by a heaving bus, and `check:swept-bus` sweeps a static
bus (its control lift is 200 m). One owner for the upward travel (the
terms `CAT_BUS_RIDE_LIFT` is built from), a driven-top export, the claim
reads it, the check sweeps with it. Notes for the PR body: the 91
`legacy:collision` refusals on the canonical race ring (walk-past post
circles wider than walk-past claims — a second definition; stage 5's
first row); the `World.ts` reorder needs the per-seed digest accounting
for every non-trestle group; a stale "ear tips included" comment in
`roadCorridor.ts`; the sightline keep-out grows 6.8 cm. Step 3's brief
corrected on the collision predicate (it is not zero).

## Re-review, 6 Sep late — step 2 at `65982c2a`: one item left

Measured on the sha (not the account): claim carries 6.6411 m; `tallestHeadroom`
6.6411 on a headless park; `trestleClaims` clips at `ground + headroom`, so
the 6.35 m fork nodes are inside the band; swept-bus child canonical 0/0/0
with the driven envelope; rest-top assertion VOID on every built seed at
+1 cm; hill digests differ in exactly the three trestle groups on both
building seeds; sphere-merge digests (`digest2/`) 8 of 14 identical, 6
trestle-only, no other group anywhere — the `World.ts` reorder moved
nothing.

**Remaining change**: `CAT_BUS_DRIVEN_TOP` 6.6411 over-states the posed
vertex-precise top by 0.147 m (heave 6.2429; + nose-up pitch 6.4991;
+ roll 6.4943 — roll *lowers* the crown 4.8 mm; the crown is at x = 0).
Required: the check asserts the driven top against the bus posed at full
heave + pitch + roll within 1 mm (as the rest top is), and the owner is
derived from the face ellipsoid under the pitch rotation, roll
contributing nothing at the crown. `suspensionTravelAt` stays right for
the chin, wheels and step (off-axis points).

## Step 2 approved, 6 Sep late — `61b306e0`

Measured on the sha: rest top 6.0429 = owner; posed highest 6.4991 (heave
+0.2, nose-up pitch, roll 0) = `CAT_BUS_DRIVEN_TOP`; the ideal ellipsoid's
support function sits 0.96 mm above the drawn polygon pole (so the
polygon derivation is required, not decorative); driven assertion VOID at
+1 cm on both built seeds; tsc 0; canonical sweep 0/0/0 with the posed
envelope. Approved, PR to open once the sphere reaches the design branch.
**Struck**: an earlier note here said the canonical walk-past ring lost a
leg (93 → 92) under the driven-top claim. That was measured on the branch
tip alone — hill geometry, road through the ring's band — and does not
reproduce on the sphere merge (50 + 50 per ring, 0 differing, engineer's
measurement on `b6b1a983`). A hill-only number reported without its base;
nothing disappears in the park that ships.

## Ruling, 6 Sep late — one rail race (Jim): cross-ring constraint deleted

Design doc "One rail race (Jim, 6 Sep)". Both rings claim as one feature
`railRace`; walk-past colliders registered after both rings are placed
(they stay — CollisionWorld, NavGrid/NPC routes, LampPosts, check:park,
invariant #4 read them); the ~100 canonical `legacy:collision` refusals
go. Recommended to land inside step 2. Step 3 brief re-cut to inherit.
Open with Jim: whether the ride-scale ring may stand on/over the bus road.

## Ruling, 6 Sep late — the road rule (Jim): skip legs over the road

Design doc "The road rule (Jim, 6 Sep)". One sentence: a slot whose foot
disc at its nominal position overlaps the road's corridor claim (=
`ROAD_HALF_WIDTH`, one owner) is not built; everything else as today.
Fires on 0 slots on the sphere. Deletes: `Claim.headroom`,
`tallestHeadroom`, the corridor's bus height, `trestleClaims`' headroom
(clip stays at `TALLEST_CHILD_HEIGHT`), the road's registry outset march
and the `supportGround.ts` deletion, and **step 4's customer** — step 4 is
HELD without one. Stays: `CAT_BUS_TOP`, `CAT_BUS_DRIVEN_TOP` + posed-crown
owner (read by `check:swept-bus`), `suspensionTravelAt`. Lands in step 2's
series with the one-rail-race deletion.

## Re-review, 6 Sep night — step 2 at `091d813c` (one rail race + road rule + whole-tree): one item

Measured: features `[road, railRace]`; `legacy:collision` 0 both rings;
4 slots per ring skipped on the canonical hill seed; swept-bus 14/14 hill
seeds build, 9 at zero; **residue true** — 0 of 25 residual posts on seeds
5/11/326/346/451 inside the road's claim, all beyond the kerb claim's
clipped end (hill `kerbReach`) under a bus run to x −29.9.
`test:procgen` hill: 20 red / 668 green. Three invariants hill-only (road
along the ring: 59.7/71.7 m runs, duck bars 9/9/8/9, kerb clip). **One is
not**: "only the walk-past ring is solid" misfires on 44 race legs per
seed (canonical included) because race legs now share slots with walk-past
legs and the clause detects solidity by "a circle contains this leg" —
re-cut to "collision holds exactly the walk-past feet". Filed for later:
`CAT_BUS_WIDTH` 5.28 vs drawn 7.30 (the bus-run invariant under-asks).

## Step 2 approved again, 7 Sep small hours — `ab763a4d`

Clause 4 re-cut to "what a collider is": walk-past legs have a collider
of their own foot radius (0.272) centred on the foot; no collider of the
race radius (0.680) on a race leg. Proved red by registering the race
ring's feet (46 legs), green restored. Radii differ by `RIDE_SCALE` (2.5),
owner-derived — precondition `RIDE_SCALE ≠ 1`, asked to be asserted in
the clause. **Corrections**: the road rule fires on one slot per ring on
six sphere seeds (engineer's measurement; my "zero" was reasoned, not
measured), and on 131/326 that slot carries a duck bar — fairness alarm
firing as designed, left with Jim (2 of 14 seeds, one bar, one racer).
`CAT_BUS_WIDTH` 5.28 vs drawn 7.30 still to file.

## Ruling recorded, 7 Sep — the road rule's final form (Jim)

Ride-scale ring keeps every leg; walk-past ring skips its own. Design doc
"The road rule", "Final form". The load-bearing fact — the rings are never
co-present — is now written once, with both consequences hanging off it
and `RailRace.setActiveRing` named as where it lives. Seed 326's possible
one-bar cost is accepted by Jim with the number; PR-body item, not his.

## Step 2 approved at `a06178a4` (7 Sep); fairness ruling

Measured: tsc 0; ground-claims 0 (walk-past skips 4 hill slots, race ring
"ignores the road"); radius guard red at equal radii, green restored;
sweep names the walk-past ring. Ruling (design doc, "Fairness is the race
ring's property"): equal-per-racer asserted on the race ring only; the
walk-past ring's lane counts equal the race ring's minus road-rule skips,
printed. Expect 706/706 on the sphere merge after the re-cut.
