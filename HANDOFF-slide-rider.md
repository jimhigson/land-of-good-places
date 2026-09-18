# HANDOFF — `check:slide-rider` on `feat/procgen-on-sphere`

Branch `fix/slide-rider`, off `origin/feat/procgen-on-sphere` (base commit
`ae20b9fc`). PR target: `feat/procgen-on-sphere`. **Model: Opus 5 (1M context)**,
chosen by the Overseer; a replacement runs the same model.

Browser: **not allocated** to this task (the fairy-lights engineer has it). Work
is build-verified only; the PR must say so and list what needs visual QA.

## The failure, reproduced on the base branch

```
beat 1 trackside frame 240  head  1592 px   body    42 px   body is  0.13% of frame
```

against a 0.40% floor. The other five trackside samples were 1.22–2.75%.

## Root cause — measured

Walking beat 1 frame by frame, printing eye-to-rider distance and
`endOn` = |dot(viewDir, bodyAxis)| (1 = straight down her body, 0 = broadside):

```
  frame 170  dist 6.89 m  endOn 0.002  head  2202  body   832  body% 2.57
  frame 210  dist 6.97 m  endOn 0.655  head  2511  body   460  body% 1.42
  frame 240  dist 8.89 m  endOn 0.910  head  1592  body    42  body% 0.13
```

Distance was fine throughout and inside every allowance the placement code had.
The **angle** collapsed: the chute turns inside a beat, the eye was built from
the beat's **midpoint** frame, so it is broadside at the midpoint and end-on at
the ends. The 75° elevation constant was a hand-tune against the same symptom on
the old chute. Beats stretch with the park (#241), so this gets worse, not
better.

## The fix

`planSlideShots` now sweeps anchor × elevation × standoff, scores every
candidate by the worst apparent body extent across its own beat
(`sin(theta)/distance`), and **probes them in that rank order against the chute
as built**, taking the first actually clear. Backtracking, per CLAUDE.md.

An analytic cross-section wall test was written first and was **wrong**: it
drops the along-chute component, and on beat 5 the chute bends back so the
trough blocking the shot for 31 frames belonged to a different part of the curve
1.4 m in front of her. The built chute is available at plan time — it is asked
directly. Do not reintroduce the analytic version.

`parkFacts` + the existing trackside invariant gained a fifth clause: the worst
body extent per beat, floor `0.06`, calibrated against the pixel check on shared
frames (0.40% of frame ≈ 0.064 extent). This is what gives the other seeds cover
that `check:slide-rider` (canonical seed only) cannot.

## Status

- [x] reproduced, root-caused
- [x] fix implemented; `check:slide-rider` green (exit 0)
- [x] new invariant clause added and proved capable of failing (seed 24 read
      0.0546 against the 0.06 floor before the search was resolved finely
      enough; fixed by raising the search's sample count, not by lowering the
      floor)
- [x] `test:procgen` failure set **identical** to the base branch — 55 on both,
      none added, none fixed. The base branch is already red here.
- [ ] dense per-frame pixel sweep (the check samples only 2 frames per beat)
- [ ] `pnpm run check` end to end
- [ ] deliberate break of both assertions, transcripts pasted
- [ ] PR

## Notes for whoever takes this over

- `scripts/` is outside every tsconfig project, so `tsc --noEmit` proves
  **nothing** about `check-slide-rider.mts`. Running the check is the only proof.
- `scripts/diag-*.mts` in the worktree are scratch and must not be committed.
- The 0.40% threshold (`TRACKSIDE_BODY_FLOOR`) is untouched, and `scripts/` has
  no diff against the base at all.
