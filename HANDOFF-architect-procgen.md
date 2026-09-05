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

## State at a glance (for a cold pickup — details in the checkpoints below)

- **Worktree**: `.claude/worktrees/design-round-robin` on
  `design/round-robin-generation`, merged with `origin/main` at `61e95fe5`
  (5 Sep). Docs-only branch, no code.
- **The design is fully written** and re-read against #474 (warp vectors =
  baked backtracking, retired by stages 4/5) and #498 (below).
- **Jim ruled (5 Sep): "no flat ground — it is a sphere".** The park
  comes off its hill (#511); both ceilings of the over-determination were
  hill constants (`RIM_OUTSET_START`); no party yields. Doc section
  "Stage 3, ruled". Architect's rulings there: the three `*_RADIAL_NUDGES`
  ladders are deleted (one outward march, one function, stops where the
  world says); claims describe the drawn *post* below the road's headroom,
  not the foot; a refused foot's next decision is a support *shape*.
  **Corrected 5 Sep**: a radial nudge is a *lean*, so "trestles escape
  outward" is struck; the road moves outside the ring's band (centre ~16,
  0.1 m foot margin). **Prediction on record, restated**: with the road
  outside the ring, posts at height are clear wherever feet are; the
  binding number is the foot margin. **First prediction CONFIRMED on built parks** (seeds 24/131/326: feet 0,
  posts 1–2; table in the doc). Restated one (road outside ring → feet
  bind) still unmeasured; #511 Engineer measuring next.
- **Seed 288 throws on bridge siting** (#511 branch only; not on main —
  latent, revealed by the sphere). Filed under stage 4 as the first real
  customer of crossingSites-as-exploration; the seed fix is the #511
  Engineer's; the silent-skip harness half is #524.
  Terrain is no longer seed-dependent (1200 m sphere) — the outward
  march's bound is the support's lean limit, not the ground.
- **Briefs**: step 1 nearly landed (byte-identical, 16 seeds). **Step 2a**
  (`BRIEF-stage3-step2a-swept-bus-instrument.md`, swept bus vs drawn
  posts as a ratchet) **READY today**. Step 2 held on step 1 + #511 +
  step 2a in the chain (dispatched). Steps 3, 4 sequential after. Step 4 re-cut: no clause
  to delete; it is the `CoSolveEngine`→`GroundClaims` migration + the
  first support-shape negotiation + counters, shrinking if the sphere
  alone suffices.
- **Step 1's finding, folded in**: the road is not constants — the spur's
  end depends on `publishPaving()` inside `new World`, after generation;
  the road is a two-turn (provisional → realised) placer. Trap for step 2:
  legs are built at `World.ts:214`, entrance at `:268`.
- **#498** (`fix/road-487-488`): OPEN, CONFLICTING (only
  `scripts/coplanar-baseline.mts`), two unanswered "changes requested"
  reviews (blocker: swept-bus checks feet, 8–9 leaning posts/seed still in
  the bus body), `test:procgen` red on 5 seeds (61–67 m ring on air),
  engineer's handoff says "needs Jim's yes" on the apron. Nobody on it;
  the local `road-487-488` worktree is a stale mid-rebase with nothing
  unpushed. Its #487 visibles and the swept-bus instrument are worth
  landing separately — Overseer's call, reported.
- **Next action if resumed**: review step 1's PR for the one-owner rule
  when it opens; when the #511 engineer's five-seed measurement arrives,
  confirm or strike the prediction and release step 2. Otherwise idle.

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
