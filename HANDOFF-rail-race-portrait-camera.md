# Handoff — Rail Race portrait camera

Branch `fix/rail-race-portrait-camera`, worktree
`.claude/worktrees/rail-race-portrait-camera`.

Jim played the Rail Race in portrait on a phone: **"it is too zoomed out"**.

## Root cause

The shipped rig was four hand-set numbers (DISTANCE 30, RISE 11, LEAD 9,
VIEW_HALF_WIDTH 19.4). It held the *metres of track visible* fixed across every
aspect ratio — a good promise — but delivered it by growing the frame
**taller** in portrait, never closer. Measured on the shipped code:

```
                          rider at   ahead visible   frame width   px/m   camera dist
landscape 1280x720        u=0.244    26.1 m          37.6 m        34.1   30.6 m
phone portrait 390x844    u=0.244    26.1 m          37.6 m        10.4   30.6 m
```

Same 37.6 m of world across a 390 px phone as across a 1280 px monitor: 10.4
px per metre against 34.1. Second, smaller fault: the damped follower (half-life
0.12 s) lagged the rider by `halfLife/ln2 × speed`, and LEAD=9 cancelled that at
exactly one speed — so the rider slid from u=0.24 at rest to about u=0.37 flat
out, spending *more* screen on the road behind exactly when they needed the road
ahead.

## The fix

Two things asked for, everything else derived:

- `AHEAD = 27` m of track in front of the rider reaching the right-hand edge
  (`AHEAD_SCREEN_X = 0.95`). One number for every window shape — the old promise
  restated about the rider instead of the middle of the frame. 27 > the 26.1 m
  measured on the shipped rig, so no warning distance was traded away.
- `RIDER_SCREEN_X`: 0.28 on a monitor ramping to 0.10 on a phone stood up.

Derived: camera distance, aim angle, FOV.

**Maths** (`solve()`): wanting R at `riderNdc` and F at `aheadNdc` fixes the
angle the chord R→F must subtend at the camera,
`Δ = atan(aheadNdc·tanH) − atan(riderNdc·tanH)`. By the inscribed angle theorem
the camera must therefore stand on a circular arc through R and F; standing at β
to the chord puts it `L·sin(β+Δ)/sin Δ` away. The rig stands at β = 90°
(`L/tan Δ`), which the ring's own curvature already makes ~14° forward of
straight out from the rider. The closed form is horizontal-plane only and the rig
is tilted, so it is out by ~2%; it seeds a bisection on aim-swing and distance
against the **real projection matrix**, run once per resize (the ring is
rotationally symmetric, so the answer depends only on the window).

Follower now leads by `FOLLOW_LAG = FOLLOW/ln2 × speed` (damped speed estimate),
so the rider sits at RIDER_SCREEN_X at *every* speed, not just at rest.

## Measured after

```
                          rider at   ahead visible   frame width   px/m   camera dist
landscape 1280x720        u=0.280    27.0 m          34.1 m        37.5   27.3 m
phone portrait 390x844    u=0.100    27.0 m          20.5 m        19.0   17.8 m
```

Portrait rider **1.83× bigger**, camera in from 30.6 m to 17.8 m. Landscape
1.10× — mild, as asked.

## Status

- [x] camera.ts rewritten
- [x] check-rail-race.mts asserts the picture off the projection matrix at six
      window shapes; side-on assertion is now a bounded range, swept at two
      shapes. Watched to fail five ways (see the file's own note) — including
      putting the shipped rig back, which turns out to have aimed 9.6° BACKWARDS
      of the rider while the old check scored it a perfect 0.000.
- [x] full `npm run build` exit 0, before and after the rebase
- [x] rebased onto main @ 9c65d78 (PR #145 spark/bonk not merged yet, so no
      overlap to resolve; it touches RailRace.ts/track.ts/RaceHud.ts, this
      touches camera.ts + the check)
- [x] PR **#147** — https://github.com/jimhigson/land-of-good-places/pull/147
- [x] browser QA — **done**, and it found a real bug. See below.
- [ ] (nothing outstanding)

## What the browser found

The rig solved its framing against a point on the rail, but the rider sits
~1.9 m above the rail, and a tilted camera divides by a depth that raising a
point shortens — so a raised point already off centre is pushed further off it.
Live measurement: rider asked for at 10% across, arrived at 8%, dipping to 6.4%
on the undulation — i.e. clipped by the left edge of a 390 px screen. Fixed at
the cause in 60d235a (solve at the rider's height; RIDER_SCREEN_X_PORTRAIT to
13%); re-measured live at 11.6–16.9%, never clipped. The check had the same
fault and now shares the rig's constant.

Final portrait numbers: 22.4 m picture, 17.4 px/m (was 10.4 = **1.67x**), 33.5 m
of road ahead (was 28.7). Landscape 37.5 px/m (was 34.1). Screenshots committed
to `art/renders/rail-race-portrait-{before,after}.png` and posted on the PR.

Treeline occlusion at r≈75: clear, occludes neither track nor rider, and the
before shot has more of it. Lane separation: reads well.

Superseded note, kept for context — chrome-devtools was owned by
      the PR #145 agent throughout; the Overseer will message when free. Want a
      390x844 portrait before/after. Two things specifically worth eyes on:
      the rig now stands at r≈74 (was 83.5) and 5.7 m up (was 11), so it is
      nearer the treeline outside the wall at r=60 — confirm nothing gets
      between it and the race; and the four lanes separate in depth more
      strongly from 18 m than they did from 30 m, which should read better but
      is a judgement call. Everything else is measured and passing.

Scratch scripts have been deleted; the tree is clean.
