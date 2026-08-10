# HANDOFF — cheaper park generation (#252, #209)

Branch: `e-cheaper-gen` · Worktree: `.claude/worktrees/e-cheaper-gen`
Base: `origin/main` @ `79018c0` (the cat-bus fix #264).

## The job

First-play park build is 40-60 s on a slow tablet because generation is
genuinely expensive. Make the park **cheaper to generate**, byte-identical on
all five CI seeds. The cruiser (#258/#259) and train (#253) were already
optimised on this base; the profile confirmed the build is now **slide-
dominated**.

## Where the time went (canonical seed, this machine, `measure-procgen --no-world`)

Baseline TOTAL 5021.7 ms: slide **4156**, cruiser 746, boundary 47, train 40,
railRace 12, paths 11, layout 9. The slide is 83% of the solve.

CPU profile of the slide solve (self-time) put the cost in the per-sample
predicate `chuteMayPass` (844 ms) — it ran on every sample of every candidate
piece, and the search draws millions (canonical 3.3M, seed 5 9M).

## The constraint that shaped everything

**Byte-identity is absolute** (task + `check:park-boot`). The search is RNG-
pinned and its candidate count is fixed by the seed, so I **cannot** reduce the
number of steps without changing the route. #209's "prefer gentler pieces
first" would reorder the search and move the route — that is a design change for
Jim, deliberately NOT done here. My only lever is **cheaper per step, identical
decisions and float values**.

## What shipped (all in `src/world/slide/solve.ts`, slide-local)

1. `02812d8` — three byte-exact cuts to `chuteMayPass`:
   - avoided-plot test walked `PARK_LAYOUT.entries` (a Map) per sample with
     tuple-destructuring + a `JOINED_PLOTS.has(id)` Set lookup; prebuilt into
     parallel `Float64Array`s (`AVOIDED_PLOTS`).
   - `clearsTowers` ran 8 `distanceOutsideTower` calls per sample; a two-`abs`
     bounding-box gate (`TOWER_BOUND_X/Z`, derived from `CASTLE_TOWERS`) returns
     "clear" for samples out by the pit/boundary without touching a tower.
   - per-plot loop skips a plot's `Math.hypot` when it is already > r away on
     either axis (`hypot >= max(|dx|,|dz|)`, so no blocker is dropped).
2. `9e8f443` — `clearsCruiser`'s cruiser-clearance grid `Map<int,int[]>` →
   dense flat array indexed `(cx-minCx)*depth+(cz-minCz)`; per-query bucket
   iterator → index loop. Same buckets, same segment order.

**`Math.hypot` kept everywhere** (never squared) so no borderline point flips in
the last bit — the reason the routes stay identical.

## Results (canonical, this machine)

| stage | before | after |
|---|---|---|
| slide | 4156 ms | **2988 ms** (1.39x) |
| whole park solve | 5021.7 ms | **3900.9 ms** (22% off) |

`chuteMayPass` self-time 844 → 75 ms; `clearsTowers`/`distanceOutsideTower`
dropped out of the profile; `clearsCruiser` 245 → ~150 ms. Remaining slide cost
is now the **shared** generator (`selfClear`, `minCurvatureRadius`,
`signedAngle` atan2, `rotate` cos/sin) — already heavily optimised by prior
sessions and largely inherent math.

## Byte-identity proof

`measure:slide-fingerprint` + `measure:cruiser-fingerprint` on all 5 CI seeds
(20260728, 2, 5, 11, 18), before vs after: **`diff` empty** — route SHA, chute
SHA, backtracks, candidates all identical, slide AND cruiser.
Baselines: scratchpad `fp-before.txt` / `fp-after.txt`.
`check:park-boot` green: sliced == straight-through, slide `5d639eb0`, cruiser
`29998c976bc8`.

## Verification

- `check:park-boot`: **exit 0**.
- `npm run test:procgen`: **321 passed (321)**, exit 0.
- `npm run build`: (see below / build.log).
- `check:solve-cost` (in build): slide 3135.9 ms vs unchanged 32560 ms budget —
  **no budget weakened**; my numbers sit well under the existing ones.

## Notes / follow-ups

- No new procgen invariant added: the change alters no placement rule, only the
  cost of computing the identical park. The fingerprint diff + `check:park-boot`
  are the guard, and they prove the output is unchanged.
- Further wins need either the shared generator's inherent math (atan2/cos/sin/
  hypot in already-optimised loops — low reward, touches the cruiser) or a
  search-trajectory change (#209 — moves the route, needs Jim's sign-off).
