# HANDOFF — coplanar baseline

**Model: Claude Opus 5 (1M context)**, chosen by the Overseer's dispatch brief
(Engineer default). A replacement runs the same model.

**Branch:** `fix/coplanar-baseline`, based on `origin/feat/procgen-on-sphere`.
**PR:** #690, against `feat/procgen-on-sphere`.
**Worktree:** `.claude/worktrees/coplanar-baseline`.

## Task as briefed, and how the brief was wrong

Briefed as: `Coplanar faces` is red on five branches because of five stale
baseline entries; delete them and the check goes green.

**The premise is wrong and this is the main finding.** Deleting the five is
correct and done, but `feat/procgen-on-sphere` is *also* carrying **23
new-or-worse coplanar findings** (19 `NEW`, 2 `WORSE`, 2 `MORE`). The check
stays red after this PR. Local run and CI on base sha `76224f91` agree exactly,
so it is not an environment artefact.

Per the brief ("stop and report NEW/WORSE rather than fold it in"), the 23 were
left untouched and reported up.

## Done

- Five `BASELINE LOOSE` entries deleted from `scripts/coplanar-baseline.mts`.
- The ~40-line comment attached to `boundary-blocks|rail-fence` had a closing
  paragraph asserting the entry exists. Rewritten to record the deletion and
  that **#612 is not closed** by it; all measurements above it kept verbatim.
- Committed `be562560`, pushed, PR #690 open.

## Proof already taken (do not redo)

- `check:coplanar`: `BASELINE LOOSE` 5 to 0. Headline unchanged both runs:
  `check:coplanar — 23 new or worse coplanar seam(s):`. Sorted
  `NEW`/`WORSE`/`MORE` sets identical before and after — deletions hid and
  created nothing.
- `git diff --stat origin/feat/procgen-on-sphere...HEAD` (three dots):
  `scripts/coplanar-baseline.mts | 17 +++++++---------`, one file only.
- `test:procgen`: 55 failed, 638 passed. Failing test **names** diffed against
  CI on base sha `76224f91` — 16 distinct names either side, none added, none
  fixed.
- #520 rename hazard ruled out for all five: every mesh name still present in
  `src/`. Notably `wooden-walls` (`Scenery.ts:2125`) and `stone-walls`
  (`Scenery.ts:2237`) are both live, so the `LOOSE` wooden / `NEW` stone pair
  is two real events, not one rename.

## Traps worth inheriting

- **`scripts/check-coplanar.mts` contains literal NUL bytes** (lines 400, 408,
  a field separator in template strings). `file` calls it `data` and plain
  `grep` **silently skips it** — `grep -rn "LOOSE" scripts/` finds nothing in
  the very file that prints `BASELINE LOOSE`. Use `grep -a`. Reported in
  #690's body; deserves its own issue.
- **BSD `sed` does not understand `\x1b`**, so the obvious ANSI strip when
  diffing vitest names out of a CI log silently yields *zero* names and a
  confident, entirely wrong "16 failures added" answer. Use `perl -CSD`, and
  strip literal `^[` two-character escapes too — `gh run view` emits both.
  Caught only by refusing a base count of 0.
- The script header comment says the pool is "the sixteen parks"; it is **ten**
  seeds. Filed as #679.

## If picked up next

Nothing outstanding on this PR — it needs a reviewer and the Overseer's merge.
The real open work is the 23 new-or-worse seams on the sphere branch, which is
somebody's separate ticket, and fourteen of them are one defect: the rail-race
finish rainbow's adjacent legs (`finish-rainbow-leg-N-inner/outer` vs `N+1`),
seed 20260728, 6.0e-3 m stand-off.
