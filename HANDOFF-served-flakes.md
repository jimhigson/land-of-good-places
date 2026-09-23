# HANDOFF: served-flakes (#699, #700, plus the solve-cost NOTE)

Branch `fix/served-flakes`, PR #703, based on `feat/procgen-on-sphere` c190ba58. Stopped by the Overseer; everything is committed.

## Root cause (done)
Both flakes were caused by `InputSystem` dropping any key (or mouse button) that went down and came back up between two frames. Escape was lost, so the keychain view stayed open and she stayed `riding`:
- `check:walking`: the tap moved her 0 m. The CI red was seed 131.
- `check:deep-links`: the autosave refuses while riding, so it hit the 60 s timeout. The red was seed 208.

**Fix:** `tappedKeys` / `clickedMouseButtons` count as down for one frame. `test/input/sub-frame-tap.test.ts` has 5 cases; 3 fail with the fix reverted.

## Changes to the checks (done)
- Seed pinned with `?seed=` (canonical by default, `CHECK_*_SEED=n` for another). Each page must report that seed back.
- Escape is dispatched as keydown and keyup in one task (`scripts/lib/keys.mts`), so it is certainly inside one frame.
- `check:walking` finds open ground using Selection, the parade and `pickWalkablePoint`, instead of tapping a fixed spot (on seed 428 that spot was a tree).
- Both checks report a dropped Escape as its own named failure.

## Wiring (done)
- `check:served-walking` is alone in shard 8.
- `check:served-deep-links` is in shard 5.
- Chromium is installed on every shard.
- `KNOWN_ORPHANS` is empty.

## solve-cost NOTE (done)
`worldPhase.ts` exports `WORLD_PHASE_FEATURES`. `solveWorldPhase` throws if its builders disagree with it (proved red via `check:ground-claims`). The NOTE is printed from it.

## Proof so far
- Mutation (fix reverted, seed 20260728): both checks red, with named messages.
- Local green: seeds 20260728, 131 (walking), 208 (deep-links), 428 (walking).
- CI on head 45cd4566, all green, with no failures in between:
  - PR run 35925462430
  - dispatch 35925466719
  - dispatch 35926459826

## Remaining
- ≥5 consecutive green CI runs were asked for; 3 are recorded. Re-run with sequential
  `gh workflow run checks.yml --ref fix/served-flakes`, one at a time (same concurrency group), and record every result.
- Add the run list to the PR body.
- Visible change: quick key taps now register (for example, Escape on `/keychain-stall`), so this PR waits for Jim.
