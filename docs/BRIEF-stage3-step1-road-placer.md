# Engineering brief — stage 3, step 1: the entrance road becomes a placer

**Status: HELD as a proposal until PR #498 (`fix/road-487-488`) merges.** This
brief is written against #498's file layout (`entrance/roadRoute.ts`); #498
was OPEN and CONFLICTING when this was drafted, so **your first task is to
re-verify every commit point named below against the `main` you actually
branch from.** If a file or symbol has moved in the merge, the brief's
intent binds, not its line references.

Authority: `docs/DESIGN-round-robin-generation.md`, section "Stage 3,
specified" — read it before this brief, and read
`src/boot/parkGeneration.ts`'s module header (the import-ladder account).
One engineer, one worktree, normal CLAUDE.md discipline throughout.

## The rule a reviewer looks for first

**The exploration query and the commit check must be the same function, and
the claim must BE the route — never a copy of it.** Concretely for this
step: the corridor geometry published to `GroundClaims` and the centreline
the road mesh is built from must be one object from one owner. If your
diff contains a claim constructed by re-computing or approximating the
route the builder uses, the PR is wrong even if every check is green —
that is the two-definitions disease this whole design exists to kill, and
"a comment promising the two agree is not a mechanism" (CLAUDE.md).

## What this step is

Move the entrance road's route decision out of module-load/scene-
construction time and into a `SolveScheduler` task that publishes a
**corridor claim** to `GroundClaims` (`src/boot/groundClaims.ts`), with the
built road consuming the claimed centreline.

- **Task**: add a `roadRoute` task to `parkGeneration.ts`'s scheduler,
  following the prewarm-letterbox pattern the cruiser/train/slide already
  use (`offerPrewarmed*`). The task computes the route (today's
  `roadRoute.ts` logic, unchanged), publishes one corridor claim, and
  offers the result through a letterbox the entrance/bus modules read.
- **Ladder**: give the task a rung/gate consistent with today's order —
  this step does **not** confront the ladder (that is step 3). Place the
  import so the route is decided at the same effective point in the boot
  it is decided today.
- **Claim**: kind `corridor`, geometry derived from the same polyline
  object the builder receives. Width from the road's existing single
  owner — do not introduce a new constant; if the road has no single width
  owner today, making one IS in scope (one owner, everyone else asks).

## What must not change

- **The park, at all.** This step is byte-identical by design (design doc:
  "each step a small PR, byte-identical until the last"). The road's
  polyline, on every pool seed, hashes identically before and after.
- **PR #498's named road-corridor clause in `railRace/track.ts` stays.**
  Deleting it is step 4's acceptance, not yours.
- **No trestle changes** (step 2), **no ladder loosening** (step 3), **no
  negotiation** (step 4).
- No new `SECTION_LENGTH`-style constants anywhere (design doc, "What a
  section is").

## Acceptance — measured, not asserted

1. **Byte-identical proof**: extend `check:park-boot`'s hash set with the
   road polyline (sliced vs straight-through, and before-vs-after this
   branch), all pool seeds. Quote the hashes in the PR.
2. **The claim is the route**: an assertion (test or check script) that the
   registry's corridor claim for the road and the built road's centreline
   are the same object/data — by identity or byte-equality of the single
   owner's output, not by tolerance comparison. **Break it deliberately**
   (perturb the claim copy) and paste the red run in the PR, per
   CLAUDE.md's "a check can pass without checking anything".
3. **The registry sees the road**: `GroundClaims` contains exactly one road
   corridor claim after generation, on every pool seed (a one-line probe).
4. Full gates: `pnpm run check`, `pnpm run test:procgen`,
   `check:coplanar` — exit codes captured directly, never through
   `tail`/`head`.
5. `check:entrance-road` (from #498) untouched and green — it is the
   independent instrument; if your change requires editing it, stop and
   escalate.

## Traps, pre-paid

- `roadRoute.ts` may solve at module load via a top-level `const` (the
  pattern the ladder exists for). If so, the module must become
  letterbox-fed like `train/plan.ts` did — see #499's handling and the
  #252 misattribution story in `parkGeneration.ts`'s ladder comment.
- `test/procgen` static imports of seed-dependent modules pin every seed
  to the canonical park (76-silent-skips disease; it bit #498 too — 328
  skips). Use dynamic imports/`import type`; watch the **pass** count.
- Byte-identical proofs must not build the park twice in one process
  (`paths.ts` mutates module-level lattice paving — the buildGraph-twice
  trap from the #499 review).
- This is invisible work (no player-visible change). Per CLAUDE.md it
  merges after review + QA measurement without Jim — and there is nothing
  to screenshot, so say so rather than manufacturing a preview link.

## Definition of done

Route decided by a scheduler task; one corridor claim in the registry that
IS the route; letterbox consumed by entrance/bus; park byte-identical on
all pool seeds with the proof quoted; all gates green; #498's clause and
checks untouched.
