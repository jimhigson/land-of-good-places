# HANDOFF — `check:slide-rider` on `feat/procgen-on-sphere`

Branch `fix/slide-rider`, off `origin/feat/procgen-on-sphere`. PR target: `feat/procgen-on-sphere`.

## The failure, reproduced

`pnpm run check:slide-rider` on this branch, canonical seed:

```
beat 1 trackside frame 240  head  1592 px   body    42 px   body is  0.13% of frame
```

against the 0.40% floor. The other five trackside samples are 1.22–2.75%.

## Root cause — measured, not supposed

`scripts/diag-slide-beat.mts` (scratch, not committed) walked beat 1 frame by
frame, printing eye-to-rider distance and `endOn` = |dot(viewDir, bodyAxis)|
(1 = looking straight down her body, 0 = broadside):

```
  frame 170  dist 6.89 m  endOn 0.002  head  2202  body   832  body% 2.57
  frame 180  dist 6.64 m  endOn 0.150  head  2466  body   835  body% 2.58
  frame 210  dist 6.97 m  endOn 0.655  head  2511  body   460  body% 1.42
  frame 240  dist 8.89 m  endOn 0.910  head  1592  body    42  body% 0.13
```

Distance is fine throughout (8.89 m, inside the 10.2 m allowance the planner
clamps to). What collapses is the **angle**: by the end of the beat the eye is
looking almost straight down her body axis, so her own head hides the rest of
her. That is a legibility failure the planner never measured — it placed the eye
from the beat's **midpoint** frame and then only ever checked *distance*.

The chute turns inside a beat (78.94 m / 6 beats = 13.2 m per beat on this
seed), so a midpoint-anchored eye is broadside at the middle and end-on at the
ends. #241's "chute stretches with the park" makes beats longer, which makes it
worse; the 75° elevation in `cameras.ts` was a hand-tune against exactly this
symptom on the *old* chute and does not survive a new one.

## The fix

`planSlideShots` now **searches** the eye placement (anchor along the beat,
elevation, standoff) against the thing the shot has to deliver — the worst
apparent body extent across its own beat, `sin(theta)/distance` — instead of
constructing one from the midpoint and clamping distance. Rail clearance stays a
hard constraint (elevation floor); the pan-whip standoff floor stays too.

## Status

- [x] reproduced, root-caused
- [ ] fix implemented and check green
- [ ] `pnpm run check` green end to end
- [ ] deliberate break proved red
- [ ] screenshot of corrected beat-1 trackside frame
