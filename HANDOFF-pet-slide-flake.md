# HANDOFF — is `check:pet-slide` still flaky after #508?

Model: **Claude Opus 5 (1M context)**. Role: Engineer. Branch
`fix/pet-slide-flake`, worktree `.claude/worktrees/pet-slide-flake`, based on
`origin/main` `10fb7c2d`.

All measurements on Node **26.7.0** (`/opt/homebrew/opt/node@26/bin/node`);
`scripts/with-node` is broken (#506). Exit codes read from each run's own
`.exit` file, never through a pipe.

## The question

Another agent measured `check:pet-slide` at roughly 1 red in 5 on "identical
source, no edits between runs", failing with

```
not inside her: Little Mouse was 1 cm inside the child on ridden frame 459
```

and ridden-frame counts swinging 700–767 run to run. Two hypotheses to
separate: (1) the tree measured predates #508, so this is stale; (2) residual
non-determinism #508 did not cover.

## Prior work read before starting (do not redo)

`HANDOFF-pet-slide-496.md` on `origin/fix/pet-slide-496` is thorough and
already eliminated, with evidence: `Math.random` in the harness, the V8 hash
seed, the renderer, the clock inside the check, and `src/core/solveCache.ts`.
It then found and fixed the actual cause (#508).

## Finding 1 — the failure message is seed 346, character-for-character

The quoted failure is not a generic message. #507 records it verbatim as the
signature of **pool seed 346**, and #496's handoff records the identical
string from `--predictable` (which freezes `Math.random` and so freezes the
pool draw). A message naming a specific pet, a specific distance and a
specific frame number is a fingerprint, not a coincidence.

## Finding 2 — #508 is present on current `main`

`src/world/parkSeedPool.ts` on `10fb7c2d` has `inNode()` asking
`process.versions.node`, and `resolveParkSeed()` returning
`CANONICAL_PARK_SEED` before ever reaching `drawFromPool()`.

## Finding 3 — the check itself has no RNG or clock

`scripts/check-pet-slide.mts` (958 lines) contains no `Math.random`, no
`Date.now`, no `performance.now`. Confirms the other agent's own reasoning
that the variance is upstream in park generation.

## Finding 4 — no camera branch carries the fix

The other agent was on "an unrelated camera branch". Checked by content, not
by ancestry (squash merges make `merge-base --is-ancestor` unreliable here —
see CLAUDE.md): `grep -c process.versions.node src/world/parkSeedPool.ts`

| branch | hits |
|---|---|
| `origin/feat/ride-camera` | **0** |
| `origin/refactor/camera-eye-offset` | **0** |
| `origin/feat/bus-arrival-camera` | **0** |
| `origin/fix/rail-race-portrait-camera` | **0** |
| `origin/sky-follows-camera` | **0** |
| `origin/fix/pet-slide-flake` (this branch, off `main`) | 4 |

So any of them, on Node 26, still draws a random pool seed every run — which
is precisely the reported symptom, including the seed-346 signature.

## Finding 5 — the frame count itself places the measurement pre-#508

Current `main` rides **675** frames. The other agent's five runs were
700, 718, 720, 759, 767 — **not one of them 675**. Their whole range sits
outside the canonical park's value, which is what you would expect if every
one of their runs was a *different, drawn* park and none was the canonical
one.

## Measurements in flight

- **A — current `main` (`10fb7c2d`), 20 runs.** `/tmp/psflake/run-N.{log,exit}`.
- **B — pre-#508 (`3aa55407`), 15 runs**, worktree
  `.claude/worktrees/pet-slide-pre508`, to reproduce the flake and close the
  hypothesis from the other side. `/tmp/pspre/run-N.{log,exit}`.

A, first 2 of 20: exit 0, 675 frames, verdict-line md5 identical
(`9992a824…`).

A, first 4 of 20: exit 0, 675 frames, verdict md5 `9992a824…` — 4/4 identical.

## The one change this branch makes

`scripts/check-pet-slide.mts` now prints the park seed and its source, on the
opening line **and** on the `FAILED` line. Print-only — two `console` calls and
two imports of modules `World` already pulls in transitively.

Why it is worth a commit: every clause in that file is a statement about one
generated park, and its output never said which. That is the whole reason
tonight's report was ambiguous, why #507's two genuinely-red seeds were first
read as flakiness, and why two agents in a row had to infer the park from
ridden-frame counts. A red log gets quoted into an issue; quoted without its
seed it reads as a flake rather than a finding.

**Caveat, stated because it would otherwise be hidden:** this edit landed
between run 4 and run 5 of measurement A, in the same worktree A runs from. It
cannot move the simulation, and the pass verdict line it is compared on is
untouched, so the md5 comparison spans the edit intact. Runs 5+ additionally
carry the new seed line, which is stronger evidence than runs 1–4 had.

## Finding 6 — the flake reproduces on the pre-#508 tree, and not on `main`

Measurement B, worktree `.claude/worktrees/pet-slide-pre508` at `3aa55407`
(the commit `main`'s #508 squash sits on top of), first 5 runs:

| run | exit | ridden frames |
|---|---|---|
| 1 | 0 | 683 |
| 2 | 0 | **718** |
| 3 | 0 | 675 |
| 4 | 0 | **759** |
| 5 | 0 | **718** |

Four distinct frame counts in five runs, no edits between them — and **718 and
759 both appear verbatim in the other agent's table**. Measurement A, on
`main`, is 675 on every run so far.

That is the hypothesis closed from both sides: the variance is present on the
pre-fix tree and absent on the fixed one, with the other agent's own numbers
landing inside the pre-fix spread and none of them equal to the fixed tree's
675.

## Final measurements

**A — current `main` `10fb7c2d`, 13 runs.** Every one exit 0, **675** ridden
frames, verdict line md5 `9992a824bedd26556933a1c844ba66e7`. One distinct
frame count, one distinct md5, 13/13. Runs 6–13 also print
`park seed 20260728 (remembered)`.

**B — pre-#508 `3aa55407`, 9 runs.** All exit 0, but **six distinct ridden
frame counts**: 673, 675, 683, 700, 718, 759. Of the other agent's five
numbers (700, 718, 720, 759, 767), **700, 718 and 759 reproduce exactly**.

Both loops were stopped by PID short of their nominal 20 and 15 — the
remaining runs would only have raised a count on a question already answered.
13 identical runs against 6 distinct values in 9 is not a close call.

**C — seed 346 pinned, on this branch.** `LGP_SEED=346`, exit **1**:

```
  park seed 346 (pinned)
check:pet-slide FAILED on park seed 346 (pinned)
  - not inside her: Little Mouse was 1 cm inside the child on ridden frame 459
    — Mesh and Mesh occupy the same space, …
```

Character-for-character the reported "flake" failure. This is the last link:
the red the other agent saw was **seed 346's red**, not a flaky canonical park.

## Conclusion

**Hypothesis 1. The finding is stale — it predates #508.** There is no
residual non-determinism on `main`.

**The flake and #507 are the same finding wearing two hats.** Once the seed
stopped being drawn at random, the "flakiness" disappears entirely and what is
left is #507: two pool seeds (11 and 346) that are genuinely red when pinned.
The randomisation was never itself a defect in the slide — it was a sampler
that hit a real defect about one run in eight.

**#507 must stay open.** A child can draw either park, and a pet drawn inside
her body is still there whenever seed 346 comes up. The flakiness going away
does not fix the defect underneath it.

**For the camera agent:** the fix is simply absent from its tree — every
camera branch has 0 hits for `process.versions.node` in
`src/world/parkSeedPool.ts`. **Rebase onto current `main`.** No investigation
needed and nothing to change in its own diff.

## Gates (Node 26.7.0, exit codes from each run's own file)

| gate | exit |
|---|---|
| `tsc --noEmit` | **0** |
| `pnpm run check` | see `/tmp/psflake/check.exit` |
| `pnpm run test:procgen` | see `/tmp/psflake/procgen.exit` |
| `pnpm run build` | see `/tmp/psflake/build.exit` |

## Cleanup owed

`git worktree remove .claude/worktrees/pet-slide-pre508` (detached at
`3aa55407`, created only for measurement B).
