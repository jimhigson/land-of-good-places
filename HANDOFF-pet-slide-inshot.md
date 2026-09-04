# HANDOFF — seed 11's `in shot` failure (part of #507)

Model: **Claude Opus 5 (1M context)**. Role: Engineer. Branch
`fix/pet-slide-inshot`, worktree `.claude/worktrees/pet-slide-shot`, based on
`fix/pet-slide-507` (so it carries the #507 spacing fix).

Node **26.7.0**. Exit codes from each run's own log.

## What was measured

Added `LGP_SHOT_DEBUG=1` to `check:pet-slide` (committed, env-gated,
stderr-only). At every raster it prints the nearest companion's share of the
frame, its centre in **normalised device coordinates**, and — only when that
centre is inside the frustum — what the camera meets on the way to it.

Inside the picture is `|ndc.x| <= 1 && |ndc.y| <= 1`.

### Seed 11 (fails) — 9 rasters

| raster | ridden frame | share | ndc.y |
|---|---|---|---|
| 1 | 236 | 6.8% | −1.40 |
| 2 | 261 | 7.2% | −1.36 |
| 3 | 286 | 7.8% | −1.29 |
| 4 | 311 | 8.4% | −1.25 |
| 5 | 446 | 5.6% | −1.44 |
| **6** | **471** | **0.0%** | **−2.29** |
| 7 | 496 | 11.7% | −0.95 |
| 8 | 521 | 7.6% | −1.35 |
| 9 | 546 | 7.6% | −1.37 |

### Canonical (passes) — 9 rasters

Shares 4.4%–12.2%; `ndc.y` from **−1.18 to −1.76**. **Nine of nine below the
bottom edge.**

## The finding

**The chase camera does not frame the nearest companion — on any seed.** Its
centre is *outside the picture, below the bottom edge*, on 9 of 9 canonical
rasters and 8 of 9 on seed 11. The clause passes only because the animal is big
enough that its top edge clips into frame from underneath; the 4–12% it scores
is scraps, not a framed pet.

Seed 11 fails when the centre drops far enough (−2.29 against a −1 edge) that
even the scraps vanish.

**This is the same shape as #507's spacing bug**, one clause over: a structural
marginality that every park shares, which one seed happens to tip over. Fixing
seed 11 alone would leave every other park one bend away from the same failure.

**Nothing is ever occluded.** On both seeds the companion is out of frame, never
hidden behind the trough or the garden.

## Two separate bugs, and the second is the more important

1. **The framing defect.** The chase camera should frame the line it exists to
   show. That is a *camera* change — and **camera branches are live**
   (`feat/ride-camera`, `refactor/camera-eye-offset`,
   `fix/rail-race-portrait-camera`, `feat/bus-arrival-camera`,
   `sky-follows-camera`), so this needs allocating rather than grabbing.
   **Do not lower `IN_SHOT_FLOOR` (0.95) or `PET_FRAME_FLOOR` (0.01).** The
   honest reading of the data is that the pet really is out of shot, which is a
   defect in the shot.

2. **The instrument cannot tell "hidden" from "not there".** `raster()` counts
   rays that land on a pet, so occlusion and absence both score 0 and `in shot`
   reports one number for two unrelated faults. On these seeds the answer is
   absence — but the check cannot say so, and a future occlusion bug would
   arrive wearing this same message. **Worth its own issue**; it is the same
   disease as a check reporting success about something it is not describing.

## A trap I fell into, recorded because the next person will

The first version of the diagnosis printed `camera meets the pet itself` for a
pet at `ndc.y = −2.29`. `Raycaster.setFromCamera` builds a ray for `|ndc| > 1`
by extrapolating past the frustum, and that ray hits the pet perfectly well —
so the helper written to expose "one number for two different worlds" committed
exactly that fault. It now refuses to follow a ray it cannot cast. **The
`OFF-TOP/BOTTOM` flag is the trustworthy field; `camera meets` is meaningful
only without it.**

## Status

Diagnosed, not fixed. Instrumentation committed and pushed. No PR raised — the
fix is a live-camera change and wants allocating first.
