# Engineering brief — stage 3, step 3: confront the import ladder

**Status: HELD until step 2 merges.** Re-cut 5 Sep for the sphere world:
nothing in this step's mechanics changed, but two facts did — (1) the road
is a **two-turn task** (a provisional corridor at generation, realised
when `publishPaving()` runs; step 1 landed it as one owner plus a
re-commit), and the ladder confrontation must keep both turns genuinely
scheduled, not fold the second into construction; (2) the trestle placer
has **no fallback ladders** after step 2, so a refused leg here follows
one refusal path — if that is ever insufficient on some seed, stop and
report; that evidence belongs to step 4. Re-verify every commit point
against the `main` you branch from. Authority:
`docs/DESIGN-round-robin-generation.md` ("Stage 3, ruled" and
"Stage 3, specified") and `src/boot/parkGeneration.ts`'s module header.

## The rule a reviewer looks for first

**The exploration query and the commit check must be the same function.**
This step is where interleaving begins, so it is where the rule starts
carrying weight: once the road and trestle tasks genuinely alternate, a
query answered from anything but the live registry (a snapshot, a module
top-level, a cached overview) is a stale read that commit will contradict.
Any such cache in the diff is a rejection.

## Byte-for-byte expectation: **THE PARK MAY CHANGE — a signed claim, not a surprise**

Stage 2's byte-identical guarantee **ends here by design**: interleaving
changes draw order. Two requirements follow:

- **Named per-placer PRNG substreams land in this PR** —
  `hash(seed, placerName, attempt)`, per the spec's determinism note.
  Landing them later would mean every subsequent placer change reshuffles
  whole parks. Determinism (same seed → same park, run to run) is still
  absolute and must be proved: two full builds per seed, hashes identical.
- **"The park changed and that is fine" is signed, not discovered.** The
  PR states, per pool seed, whether the built park's hash moved, and the
  design owner (the Architect) countersigns the diff summary before
  review. If parks change they are **visible work**: preview link with a
  deep link to something changed, one sentence naming what to look at,
  and Jim's sign-off per CLAUDE.md — do not merge this as invisible.

## What this step is

- The road and trestle placers' modules load **eagerly, or behind
  data-readiness gates — not behind task-completion gates** — so their
  tasks' `ready()` answers true while other tasks still run, and the
  `SolveScheduler` genuinely interleaves their turns with the rest.
- Their `deps` (and claims) become the real constraints. Everything else
  keeps its ladder rungs untouched: this confronts the ladder **for the
  two migrated placers only**.

## What must not change

- Any other placer's gating or order. The six other tasks' rungs stay.
- The failure semantics documented in `parkGeneration.ts` (what throws,
  where, with what message).
- No negotiation logic (step 4). A conflict surfacing during interleaving
  in this step follows the existing refusal path (retry along existing
  freedom); if that is ever insufficient on some seed, stop and report —
  do not hand-patch, that evidence belongs to step 4.

## Acceptance — measured, not asserted

1. **The perturbation experiment, re-run and inverted**: the #499 review
   measured four of six deps inert (relaxing them changed nothing). After
   this step, relaxing the migrated placers' deps must **visibly change
   the task order** — paste both orders. That is the proof the deps went
   load-bearing, and it is this step's whole point.
2. **Determinism**: two builds per pool seed in separate processes
   (buildGraph-twice trap), hashes identical run-to-run. Quoted.
3. **Change accounting**: per-seed statement of park-hash moved / not
   moved, countersigned by the Architect.
4. **Interleaving is real**: a trace (task-turn log for one seed) showing
   road/trestle turns genuinely alternating with other tasks, pasted —
   not asserted from the code shape.
5. Full suite green: `pnpm run check`, `pnpm run test:procgen` (every
   invariant, every seed — this is the step most likely to shake
   something loose), `check:coplanar`, `check:park-boot`.
6. Frame budgets hold: `check:park-boot`'s per-frame cost ceiling stays
   green — eager loading must not re-concentrate module evaluation into
   one frame (the exact disease the ladder was built to cure; see the
   #252 story in the ladder comment).

## Traps, pre-paid

- Eager import ≠ free: a single `import()` does synchronous
  resolve-and-compile for its whole unseen graph (70 ms measured for
  `coaster/solve`). "Eager" here means *earlier and gated on data*, not
  "all at frame zero". Measure frames, don't reason about them.
- `rerere` will replay stale `check`-chain resolutions on rebase; rebuild
  from main's parsed step list (CLAUDE.md).
- The scheduler's `'frame'` yields and `ready()` gates have exact
  semantics (`solveScheduler.ts`, 12 tests) — extend the tests if you
  extend the semantics; do not overload existing yield values.

## Definition of done

Two placers interleave for real (trace pasted); their deps proved
load-bearing by perturbation; substreams landed; determinism proved
run-to-run; park changes signed, not discovered; budgets and full suite
green.
