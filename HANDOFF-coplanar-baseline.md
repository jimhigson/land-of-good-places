# HANDOFF — coplanar baseline

**Model: Claude Opus 5 (1M context)**, chosen by the Overseer's dispatch brief
(Engineer default). A replacement runs the same model.

**Branch:** `fix/coplanar-baseline`, based on `origin/feat/procgen-on-sphere`.
**PR:** #690, against `feat/procgen-on-sphere`.
**Worktree:** `.claude/worktrees/coplanar-baseline`.

## What this PR is now — it is not what it was briefed as

Briefed as: delete five stale `BASELINE LOOSE` entries and `Coplanar faces`
goes green on five branches.

**Both halves of that were wrong, and the PR has since shrunk to one thing.**

1. The check was never only five stale entries — the branch also carried 23
   new-or-worse findings, reported up and left untouched.
2. **#684 then merged into the base and deleted all five entries itself.** After
   rebasing onto `8132a67f`, `check:coplanar` reports **0 loose**, so the
   deletions are redundant and have evaporated from the diff. That is the
   correct outcome; no diff was manufactured to keep the branch alive.

**What survives is one comment fix**, and it is still needed: #684 deleted the
entry but left its ~40-line comment block, whose closing paragraph read *"A
visible flicker remains… This entry records that honestly rather than hiding
it"* — asserting a fact about a line that no longer exists, now sitting
directly above an unrelated `railRace:cart` entry a reader would attach it to.
The paragraph is rewritten to record the deletion and that **#612 is not closed
by it** (the sweep stopped seeing a shared *plane*, not the interpenetration
the rest of the block measures), plus a blank line so the block cannot be read
onto the entry below. All the measurements above it are kept verbatim.

Diff against the new base is that comment and nothing else: **0 baseline
entries added or removed** (`git diff … | grep -cE '^[+-]  "'` = 0).

## Numbers re-derived on the new base `8132a67f` (not inherited)

- `check:coplanar`: **0 loose**, **11 findings** — exit 1.
- The headline says 11 but NEW+WORSE+MORE is only 10. The eleventh is a
  **`TIGHTER:`** finding, a category easy to miss when counting:
  `railRace:race-ring/trestle-branches-lower|upper`, *"now fighting at 7.6e-5 m;
  it was a stand-off when the baseline was taken"*. Under the 0.1 mm threshold
  means the depth buffer has nothing to resolve — **that seam strobes now and
  did not before.** It is the race-ring sibling of the walk-past-ring entry
  #684 fixed.
- `test:procgen`: **25 failed | 668 passed**.

Both are pre-existing on the base; this diff is a comment in a `scripts/` file
that nothing under `test/` or `src/` imports.

## Traps worth inheriting

- **`scripts/check-coplanar.mts` contains literal NUL bytes** (lines 400, 408).
  `file` calls it `data` and plain `grep` **silently skips it** — `grep -rn
  "LOOSE" scripts/` finds nothing in the very file that prints `BASELINE
  LOOSE`. Use `grep -a`.
- **BSD `sed` does not understand `\x1b`**, so the obvious ANSI strip when
  diffing vitest names out of a CI log yields *zero* names and a confident,
  entirely wrong "16 failures added". Use `perl -CSD`, and strip literal `^[`
  two-character escapes too. Caught only by refusing a base count of 0.
- **`TIGHTER:` exists** alongside NEW/WORSE/MORE/BASELINE LOOSE. Counting only
  the familiar four under-reports the headline by one.
- **`rerere` did not misfire here** — the rebase presented the comment conflict
  rather than replaying a stale resolution. It was still resolved by hand
  against the new base rather than by accepting what git offered.
- The script header says the pool is "the sixteen parks"; it is **ten** seeds.
  Filed as #679.

## Related work spun out of this ticket

- **#693** — `check:wall-tunnelling` is defined, sits only in `check:all`, and
  no workflow runs `check:all`, so it has never gated a merge. Found from the
  `(known)` line the `Checks` log prints on every run.

## If picked up next

Nothing outstanding here; the PR needs a re-review of a one-hunk comment diff
and the Overseer's merge. The real open work is the 11 coplanar findings on the
sphere branch (two need Jim's ruling, being visible), plus `check:slide-rider`
failing in `Checks` and the 25 procgen failures — all three red on the base.
