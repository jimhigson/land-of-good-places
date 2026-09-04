# Engineering brief — stage 3, step 4: negotiation, and the named clause comes out

**Status: HELD until step 3 merges.** Re-verify every commit point against
the `main` you branch from. Authority:
`docs/DESIGN-round-robin-generation.md` ("Stage 3, specified" and
"Backtracking, one mechanism instead of six"). One engineer, one worktree,
normal CLAUDE.md discipline.

## The rule a reviewer looks for first

**The exploration query and the commit check must be the same function** —
and in this step, so is the *negotiation's* question. When a refused claim
asks "who blocks me?" and "would it work if the blocker moved?", both
answers come from `GroundClaims`' own predicates (`blockers()`, the commit
check), never from a re-derivation. Three askers, one function. A
negotiation that reasons about geometry the registry didn't compute is a
fourth ground model, and the whole point of this stage is getting from ten
to one.

## Byte-for-byte expectation: **THE PARK MAY CHANGE where the pair conflicted — signed, bounded, and only there**

- Parks where road corridor and trestle footprints never conflicted must
  hash **identically** — negotiation that never fires must change
  nothing. Prove it per seed.
- Parks where they did conflict change **only in the pair's geometry**:
  diff the built park's fact set per seed and account for every moved
  entity — a moved lamp on a conflict-free seed is a bug, not noise.
- Change accounting countersigned by the Architect; conflicted seeds are
  **visible work** (preview link, deep link to the changed spot via
  `/spawn?pos=…`, one sentence, Jim's sign-off).

## What this step is

- **The refusal path runs across the feature boundary**: where road
  corridor and trestle footprint want the same ground, the trestle steps
  aside first (cheap — many candidates); if no leg placement serves the
  ring, the road's corridor re-draws (`CoSolveEngine`'s
  blockers-hint mechanism, per the spec's ladder: retry → negotiate →
  unwind).
- **`railRace/track.ts`'s named road-corridor clause is deleted.** This is
  the acceptance the Overseer fixed (3 Sep): the registry now refuses the
  same ground the clause did (proved in advance by step 2's redundancy
  demonstration), so the clause is a second definition, and second
  definitions do not get to stay for comfort.
- **Budget counters ship and report**: conflicts-per-attempt and
  retries-per-placer for the pair, printed to stderr on every procgen run
  (a coverage note nobody can hear is the same disease as a check that
  cannot fail). This is the design's first thrash measurement, and the
  number that decides when forward checking / most-constrained-first get
  built — record it in the PR.

## What must not change

- Every clearance stands: no negotiated outcome may leave less clearance
  than the hand fix achieved (the #498 stakes — same or better).
- `check:entrance-road`'s swept-bus sweep itself. The *control clause* is
  the one part that changes, deliberately — see below.
- No new named pairings anywhere. If the negotiation needs to know
  something about a feature, that knowledge enters the compatibility
  table or a claim kind, in the open — never a private clause.

## The control must be watched failing before it is trusted

The swept-bus control (151 legs across 16 seeds in #498's version) becomes
the **independent instrument standing in for the deleted clause** — the
thing that would catch the registry marking its own homework. Per the
Overseer's explicit instruction and CLAUDE.md's "break every check
deliberately":

1. Delete the clause **and disable the negotiation** in a scratch build.
2. Run the sweep. It must go **red** — legs in the bus's swept body.
3. Paste the red output **with the geometry it was proved against**
   (seed, leg coordinates) — a red-run transcript is a measurement and
   measurements go stale (CLAUDE.md).
4. Re-enable negotiation; the sweep goes green; paste that too.

A control that was never watched failing after the clause came out is a
green line implying cover it does not give. The step-2 redundancy
demonstration does NOT count — it proved the registry refuses the same
ground with the clause still present; this proves the *sweep* can see the
failure the registry is now the only thing preventing.

## Acceptance — measured, not asserted

1. Named clause deleted; universal invariant's road×trestle pairing green
   across the whole pool.
2. Control watched failing then passing, both transcripts with geometry.
3. Conflict-free seeds hash identical; conflicted seeds' diffs fully
   accounted; countersigned.
4. Clearances same or better than #498's, measured by its own instruments.
5. Budget counters reported per seed on stderr; numbers quoted in the PR.
6. Full gates green (`check`, `test:procgen`, `check:coplanar`,
   `check:park-boot`), exit codes captured directly.
7. **The stage-3 decision point is answered in the PR body**: does this
   clearly beat the hand-written fix (spec: same-or-better clearances, no
   named pairing, next neighbour covered with zero new code)? That
   answer, with its numbers, is what the Architect takes to the Overseer
   to green-light stage 4.

## Traps, pre-paid

- Deleting the clause changes nothing *visible* on most seeds — do not
  let that read as "invisible work" overall; the conflicted seeds decide.
- The negotiation must be deterministic: blocker choice and retry order
  from the fixed round order and substreams, never from map iteration.
- Do not let the road re-draw relax any #487 property (length, grey,
  curvature) — those are Jim-ruled visibles; the corridor may move, the
  road's contract may not.

## Definition of done

One mechanism where two private ones stood; the clause gone; the control
proved able to see its absence; every changed park accounted for and
signed; the beat-the-hand-fix question answered with numbers.
