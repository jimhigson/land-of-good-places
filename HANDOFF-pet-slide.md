# HANDOFF — `check:pet-slide` is red on #474 (`feat/park-warp-solver`)

Worktree: `.claude/worktrees/pet-slide-red`, branch `fix/pet-slide-check`,
based on `origin/feat/park-warp-solver` (PR #474's head).

## Status

Root cause found and measured. Fix not yet written.

## The failure, verbatim

```
check:pet-slide FAILED
  - in shot: the nearest companion filled at least 1% of the chase frame on only
    88% of 8 rasters, against 95% required (its smallest was 0.0%) — it is
    behind her, but not in the shot
```

Real numbers, no `NaN`/`Infinity`. 7 of 8 rasters pass; raster 7 is 0.0%.
The control run correctly fails everything (0% of rasters), so the instrument
is armed.

## Placement: it belongs on #474, but #474 did not touch the slide

`git diff --stat origin/main...HEAD` shows #474 changes **no** slide, pet,
camera or check code. It changes `parkLayout.ts`, `parkWarp.ts`, `paths.ts`,
`parkSeedPool.ts` and the rail-crossing tier. It also **bakes a warp vector for
the canonical seed**: `20260728: { layout: { hotel: 2 } }` in `parkWarp.ts`.

That re-solves the whole park, so the canonical park's **ginormous slide is a
different curve**. Proof — same branch, warp switched off:

```
LGP_WARP='{}' pnpm run check:pet-slide   → exit 0, 100% of rasters, smallest 4.4%
pnpm run check:pet-slide                 → exit 1,  88% of rasters, smallest 0.0%
```

So the check is red because the park changed, and the park changed on #474.

## Root cause

Two facts, both measured on the built park.

**1. The nearest pet is composed on the very bottom edge of the chase frame,
always, with no margin.** Its origin's NDC y per raster (frame bottom is −1):

| raster | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
|---|---|---|---|---|---|---|---|---|
| warped   | −0.99 | −0.99 | −0.97 | −0.96 | −0.89 | −0.88 | **−1.48** | −0.77 |
| unwarped | −1.00 | −0.77 | −0.92 | −0.91 | −0.90 | −0.89 | −0.90 | −0.89 |

Only the *top* of the reclining body pokes into frame, which is why the shares
are 3–8% against a 1% floor. The chase lens sits ~4.5 m behind her and 1.56 m
above the pet's origin, at ~1.9 m separation → ~39° below the axis of a shot
whose lower edge is 38° down. Pets 2 and 3 are **0 px on every single raster**,
warped and unwarped — they are at or behind the lens.

**2. The warped chute has slope discontinuities, and one sits exactly where
raster 7 falls out.** Chute slope in degrees, sampled every 1% of `t`:

```
warped   … 0.73:22.5  0.74:17.0  0.75:16.4  0.76:30.4  0.77:21.5  0.78:19.5 …
         … 0.56:24.4  0.57:18.9  0.58:18.6  0.59:33.7  0.60:25.7  0.61:23.3 …
unwarped … 0.73:19.1  0.74:18.8  0.75:18.5  0.76:18.1  0.77:17.7  0.78:17.2 …
```

Raster 7 is at `herAlong=0.7600`, `petAlong=0.7175` — astride the +14° spike.
The chase camera pitches with the chute, so a 14° pitch step in 1% of the chute
swings the trailing pet 0.6 m down in camera space (`petCamLocal.y` −0.86 →
−1.47, `dist` 1.89 → 2.27) and out of the bottom of frame.

The unwarped chute has the same disease, milder (0.38:14.4 → 0.39:10.9 →
0.40:17.6, a ~7° spike), which is why its margin is only 4.4%.

The chute is `new CatmullRomCurve3(points, false, 'catmullrom', 0.5)` —
**uniform** parameterisation (`SlideRide.ts:119`). Uniform Catmull-Rom
overshoots and cusps when control points are unevenly spaced; the points come
from `slide/plan.ts`, solved per-park. **Next step: confirm the control-point
spacing is uneven on the warped park, and test `'centripetal'`.**

## Verdict on which fix

The check is **right** and the geometry regressed. Do not touch
`IN_SHOT_FLOOR` (0.95) or `PET_FRAME_FLOOR` (0.01) — with 8 rasters, 0.95 means
"all 8", which is the intended bar.

## Reproduce

```
cd .claude/worktrees/pet-slide-red
pnpm run check:pet-slide            # red
LGP_WARP='{}' pnpm run check:pet-slide   # green — isolates the park change
```

Diagnostics used to get the tables above are **uncommitted working-tree edits**
to `scripts/check-pet-slide.mts` (`DIAG`/`DIAG3` stderr writes). They must not
ship; `git checkout scripts/check-pet-slide.mts` clears them.
