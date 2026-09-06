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

## Review round 2 — `(remembered)` was false on the Node path

The reviewer caught that `resolveParkSeed()` set `source = 'remembered'` in the
`inNode()` branch, the path every unpinned CI run takes, where nothing was
remembered. The line whose only job is to state provenance stated it falsely —
the same disease this branch exists to cure, one level down. `check-seed-pool`
had the tell: a clause *named* "Node gets the canonical seed" asserting
`'remembered'`.

Fixed by giving the Node branch its own `ParkSeedSource` value, `'canonical'`.
It cannot reach `main.ts:568` (`=== 'remembered'` → forget + reload), which is
browser-only, so "start again" cannot become a reload loop. The green summary
line now names the seed too — the misleading *pass* was the expensive half.

**Proved red**, mutation = put `source = 'remembered';` back in `inNode()`:
`check:seed-pool` **exit 1**, failure printing `got 20260728 (remembered) with a
storage installed`. Restored: **exit 0**, 12/12 clauses, control 4 distinct in 6.

After: `tsc` **0**; `check:pet-slide` **0** printing
`park seed 20260728 (canonical)` on both lines, still 675 frames.

Full gates re-queued after the #507 sweep (`/tmp/psflake/r2-*.exit`).

## Cleanup owed

`git worktree remove .claude/worktrees/pet-slide-pre508` (detached at
`3aa55407`, created only for measurement B).

---

## Review round 3 (5 Sep) — rebase onto #515, and the body's reproduction

Model: **Claude Opus 5 (1M context)**, Engineer, same as the agent replaced.
Measurements on Node **26.7.0**; exit codes from each run's own `.exit` file.

### The reviewer was reading a stale head

Round 3's review (5 Sep 22:04) quotes `park seed 20260728 (remembered)` and
lists `(remembered)` as a non-blocking finding. **It was already fixed** — by
`0f516e63`, pushed 4 Sep, which is two commits before the head the review was
posted against. The reviewer's rebase trial branch (`review-512-rebase-trial`,
`d860e9a2`) is built from `76bd311b`, i.e. one commit *before* the canonical
fix. Their three-dot diff of "2 files" follows from that, as does their
explanation that `parkSeedPool.ts` and `check-seed-pool.mts` were "#508's,
appearing only because the merge base is stale" — they are in fact **this
branch's own** changes.

So of the review's items: blocking 1 (rebase) was real and is done; blocking 2
(stale reproduction) was real and is done; the non-blocking `(remembered)` item
and round 2's `ok`-line item were **both already in the branch**.

### Rebase — clean, and #515 survived

`git rebase origin/main` onto `61e95fe5`, no conflicts, 8 commits replayed.

- Three-dot diff still 4 files, no deletions.
- `bendAllowanceExhaustions` (#515's): **3** references on `main`, **3** on
  HEAD. Checked deliberately — a clean rebase is the shape of a silent revert.
- `check` chain: 59 steps both sides, **step sets identical**, parsed not
  grepped. Branch does not touch the chain.

### #507 is fixed by #515 — the old reproduction is dead

Measured myself on the rebased tree, not taken from the review:

| run | exit | ridden frames |
|---|---|---|
| unpinned | **0** | 624, `park seed 20260728 (canonical)` |
| `LGP_SEED=346` | **0** | 634 |
| `LGP_SEED=11` | **0** | 739 |

Both #507 seeds green. Also note **675 → 624** on the canonical park: any note
quoting 675 for this check predates #515.

### The replacement reproduction, and its geometry

Mutation: `const ON_CHUTE = 0.5;` in `scripts/check-pet-slide.mts`. **Exit 1**,
`check:pet-slide FAILED on park seed 20260728 (canonical)`,
`Little Mouse was 0.76 m off the chute on ridden frame 121 (trough allows 0.50 m)`.

Proved against: real `ON_CHUTE` = **1.5014 m** =
`hypot(halfWidth 0.9500, above 0.8600) + PARADE_MEMBER_RADIUS 0.22`; worst
off-chute on the green run = **0.78 m**. Fires because `0.50 < 0.78`; green
because `1.5014 > 0.78`. **Stops reproducing** if the worst off-chute drops
under 0.50 m or the envelope moves — then pick a threshold under the
then-current worst off-chute, which the green run prints. Mutation reverted.

### Also taken this round

`e4a104a4` — the comment now says what the `drawn` tripwire covers (that one
`inNode()` branch, not general assurance) and that this check measures **1 park
of 16**, the canonical seed. Both were review asks; the second is #510's gap,
made legible rather than closed.

### Note for whoever runs the gates next

This worktree's `CLAUDE.md` adds **`pnpm run check:coplanar`** as a third
pre-push gate (own workflow, not in `check`). Run it; the shared checkout's copy
of CLAUDE.md does not mention it.
