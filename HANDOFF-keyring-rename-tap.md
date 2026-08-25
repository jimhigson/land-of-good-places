# Handoff: keyring-rename-tap (branch `keychain-size-physics`, PR #331)

## What this task was

Two follow-ups from Jim on PR #331 after the camera side-flip round landed:
1. "I should be able to tap on the key rings to choose one" — verify/fix.
2. "they're key rings, remove all references to 'charms'" — rename.

## Status: done, pushed, PR comment posted, waiting on real CI for the last commit

Three commits pushed to `keychain-size-physics`:

- `4ae8591` — Selection.ts: drop the blanket `player.riding` bail in
  `handleTap`/`hoverPick` (bug #1: taps did nothing at all in the locked
  keyring picker).
- `418098b` — the full charm→keyring terminology rename (see PR comment for
  the file list). CI green on this + the commit above (checked via
  `pull_request_read get_check_runs` before making bug #2's fix — all three
  jobs, Build and checks / Procgen invariants / Deploy PR preview, succeeded).
- `8d8c626` — Selection.ts + KeychainShop.ts: bug #2, found by real-browser
  QA on bug #1's fix — tap-select worked but **committing** (equipping)
  silently failed while riding, because the six keyring zones' own
  `standX`/`standZ` sit 3.2-3.9 m from the fixed point she's locked at, well
  outside `standRadius`, and a riding character can't walk there
  (`TapNavigator.navigateTo` refuses). Fixed with `Selection.ridingInReach`:
  a `selectableWhileRiding` zone is always "in reach" while riding. **Do not**
  "fix" this by widening the keyring zones' `standRadius` instead — that was
  tried first and reverted: it makes all six zones simultaneously count as
  "in proximity", which fights tap-selection via `refreshSticky`'s "walking
  up to something else wins over a stale tap" rule, and taps 2+ silently
  re-select whichever zone is nearest rather than the one actually tapped.
  (Confirmed this exact failure mode empirically before reverting — see the
  QA log if you need to re-derive it.)

As of this handoff, CI for `8d8c626` is still in progress (the "Build and
checks" job took ~16 minutes on the prior commit's run — be patient, per
CLAUDE.md). Check with `pull_request_read`/`get_check_runs` on PR #331. If it
comes back red, the diff to look at is small (`git show 8d8c626`) — re-read
this file's own reasoning above before changing the fix, since the naive
alternative (widen `standRadius`) is a real trap that looks like it works
(committing succeeds) while silently breaking multi-item tap-selection.

PR comment already posted with the full writeup + two QA screenshots
(hosted on the `qa-screenshots` orphan branch,
`pr331-keyring-tap/{opened-view-settled,after-6-taps-rumi-worn}.png`).

## What's left, if anything

- Confirm the third commit's CI is green (just needs waiting).
- Nothing else outstanding from the two asks. Do not merge — PR merging is
  the Overseer's job per CLAUDE.md.

## One incidental finding, not fixed (out of scope for this task)

In the "after taps" QA screenshot, Eleri's own body significantly occludes
the back-row RiPika and partially Star from the fixed camera angle. Flagged
in the PR comment as a possible follow-up; not something this task's two
asks covered, and not touched.

## QA method, if you need to re-verify by hand

`node node_modules/playwright-core/cli.js install chromium` (already done,
Chromium 141 installed at `/opt/pw-browsers`), then a small Playwright
script driving a `vite --port <yours> --strictPort` dev server against
`/keychain-stall` (the deep link opens the locked view immediately via
`KeychainShop.requestOpen`). Key gotcha: **the camera's own eased zoom-in
takes noticeably longer to visually settle than you'd guess** — position
data looks stable by ~t=2-3s but the actual rendered frame can still be
mid-transition past that; wait ~6s+ before screenshotting or computing tap
targets, and even then treat one early screenshot with suspicion rather
than trusting it blind. Second gotcha: click at the **near-top** of each
keyring's real hit-test box (`Selection.bounds`, keyed by
`root.uuid`), not its geometric centre — the six keyrings stand in a tight
3x2 grid with only a 0.5 m row gap, so a front-row item's box can swallow a
back-row item's centre point along the camera's ray (this is a targeting
artifact of clicking a 3D box's exact centre, not a real game bug — a real
finger aims at the visible ring, not a hidden centroid).
