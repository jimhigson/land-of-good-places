# Engineering brief — stage 3, step 2: the trestles become a placer

**Status: HELD until step 1 (`BRIEF-stage3-step1-road-placer.md`) merges.**
Written against #498's layout plus step 1's expected result; **re-verify
every commit point against the `main` you branch from** — the intent binds,
not the line references. Authority: `docs/DESIGN-round-robin-generation.md`,
"Stage 3, specified". One engineer, one worktree, normal CLAUDE.md
discipline.

## The rule a reviewer looks for first

**The exploration query and the commit check must be the same function.**
The trestle search's "may I stand here?" during candidate scanning and the
footprint claim's own commit check must be one function on `GroundClaims` —
if the search pre-filters with one predicate and the claim commits with
another, an explore-yes/commit-no disagreement becomes possible with no
sibling to blame, and the PR is wrong even while green.

## Byte-for-byte expectation: **IDENTICAL — proved, not presumed**

The park must not change. Legs stand where they stood, on every pool seed,
proved by hashing leg positions (both rings) before and after, quoted in
the PR. This is achievable because the road's corridor claim IS the road's
route (step 1's invariant), so a registry query against it must
reproduce the named clause's accept/reject decisions exactly — if it does
not, that is a real finding about the two predicates disagreeing today:
**stop and report it, do not tune the claim geometry until the hashes
match.** A tuned-to-match claim is a copy wearing a disguise.

## What this step is

- The trestle candidate checks in `railRace/track.ts`'s leg search become
  **footprint claims** asked of `GroundClaims`: commit a claim per placed
  leg; a refused candidate moves to the next (the search's existing
  freedom), then backjumps via `blockers()`.
- The **construction-order trick dissolves**: today the walk-past ring
  registers collision first so the race ring's search sees its posts
  (`RailRace.ts` constructor comment). Both rings' legs become claims in
  one registry; the ordering effect is reproduced by claim order, and the
  comment describing the trick is updated to describe the claims.
- The **named road-corridor clause stays in place** (step 4 deletes it).
  After this step it is redundant — the registry holds the road corridor —
  and the PR should demonstrate the redundancy (see acceptance 3) without
  removing it.

## What must not change

- The park (see above). The rings' routes (`RAIL_RACE_PLAN`) are untouched
  — this step migrates only the legs. *Staging note from the spec applies:*
  legs off a finished ring is an interim state; the section-by-section
  ruling is discharged in stage 4/5, not here.
- No ladder loosening (step 3), no negotiation (step 4), no deletion of
  the #498 clause (step 4), no new constants.

## Acceptance — measured, not asserted

1. **Leg-position hashes identical** before/after, both rings, all pool
   seeds — quoted in the PR.
2. **One-function proof**: the search's candidate predicate and the claim
   commit check are demonstrably the same function (by code identity, not
   by comment). Break it deliberately — make the search use a stale copy —
   and paste the red run.
3. **Redundancy demonstration**: with the named road clause temporarily
   disabled in a scratch run (not in the shipped code), leg positions
   still hash identically, because the registry refuses the same ground.
   Paste both hashes. This is step 4's safety case, bought early.
4. **The registry sees every leg**: claim count equals built-leg count,
   every pool seed, both rings.
5. Full gates: `pnpm run check`, `pnpm run test:procgen`, `check:coplanar`
   — exit codes captured directly, never through `tail`/`head`.
6. `check:entrance-road`'s swept-bus control untouched and green.

## Traps, pre-paid

- Leg placement happens at `RailRace` **construction** in `World.ts`, after
  generation "finishes" — the claims must land in the same registry
  instance the generation used; check how `World` receives it and do not
  create a second registry (one owner).
- The walk-past/race ordering is behaviour, not decoration: two concentric
  rings' legs must still never share ground. The crowding rule between
  rings must survive as claims.
- Invisible work: no player-visible change, nothing to screenshot — merges
  after review + QA measurement without Jim; say so plainly.

## Definition of done

Legs are claims; one predicate; construction-order trick replaced and its
comment corrected; byte-identical hashes quoted; redundancy of the named
clause demonstrated; all gates green.
