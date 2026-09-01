# PR #463 — all sixteen parks in the seed pool

Overhead shot and in-game park map for every seed in `PARK_SEED_POOL`
(read from the branch, `src/world/parkSeedPool.ts` @ `10e8ca70`):

```
20260728 (canonical), 5, 11, 24, 115, 128, 131, 208,
225, 267, 274, 288, 326, 346, 428, 451
```

## How these were taken

- Preview deploy `https://pr-463-10e8ca7-land-of-good-places.blockstack.workers.dev`
  (production build of the PR head), headless Chromium via `playwright-core`,
  1200x900, a **fresh browser context per seed** with `localStorage.clear()`
  before any module ran.
- **Overhead — identical framing for all sixteen:**
  `/view?seed=<n>&camPos=0,178,72&camDir=0,-178,-60&timeOfDay=12:00`
  (same height, same angle, midday in every shot).
- **Map:** `/spawn?pos=0,0&seed=<n>`, then the `M` key, captured once
  `.parkmap[data-open="true"]`.
- **Every pin was verified**, not assumed: each page logged
  `park seed <n> (pinned)` and all 32 images hash differently.
- Zero page errors on all 32 loads.

## Contact sheets

| all sixteen parks | all sixteen maps |
|---|---|
| ![](contact-overheads.jpg) | ![](contact-maps.jpg) |

## Per seed

| seed | from above | park map |
|---|---|---|
| 20260728 (canonical) | ![](overhead-20260728.jpg) | ![](map-20260728.jpg) |
| 5 | ![](overhead-5.jpg) | ![](map-5.jpg) |
| 11 | ![](overhead-11.jpg) | ![](map-11.jpg) |
| 24 | ![](overhead-24.jpg) | ![](map-24.jpg) |
| 115 | ![](overhead-115.jpg) | ![](map-115.jpg) |
| 128 | ![](overhead-128.jpg) | ![](map-128.jpg) |
| 131 | ![](overhead-131.jpg) | ![](map-131.jpg) |
| 208 | ![](overhead-208.jpg) | ![](map-208.jpg) |
| 225 | ![](overhead-225.jpg) | ![](map-225.jpg) |
| 267 | ![](overhead-267.jpg) | ![](map-267.jpg) |
| 274 | ![](overhead-274.jpg) | ![](map-274.jpg) |
| 288 | ![](overhead-288.jpg) | ![](map-288.jpg) |
| 326 | ![](overhead-326.jpg) | ![](map-326.jpg) |
| 346 | ![](overhead-346.jpg) | ![](map-346.jpg) |
| 428 | ![](overhead-428.jpg) | ![](map-428.jpg) |
| 451 | ![](overhead-451.jpg) | ![](map-451.jpg) |
