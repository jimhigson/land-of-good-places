# How steep the ground actually is — measured, not derived

Stopped early: Jim ruled (12 Sep 2026) that the sphere gets **smaller**, with
radial "up" outdoors and plain `+Y` indoors, before this investigation
finished. What follows is everything that *was* measured, because whoever
picks the new `GROUND_SPHERE_RADIUS` needs exactly this.

Reproduce: `node --no-warnings --import ./scripts/ts-extension-resolver-register.mjs scripts/measure-ground-gradient.mts`

## The instrument, and its control

Central differences on the real `terrainHeight` from `src/world/terrain.ts`,
gradient magnitude `hypot(dh/dx, dh/dz)` — the *steepest* slope at a point, in
any direction. Three controls, all run before the map and all printed by the
script:

```
CONTROL 15% plane: measured 15.0000% expected 15.00%
CONTROL 3/4 -> 5% ramp: measured 5.0000% expected 5.00%
CONTROL cap at  50 m: measured 4.1703%  analytic 4.1703%
CONTROL cap at 105 m: measured 8.7837%  analytic 8.7837%
CONTROL cap at 117 m: measured 9.7967%  analytic 9.7967%
step-size sensitivity at (61.5, -44.25): e=0.05 -> 6.163%, e=1.5 -> 6.161%
```

So the probe reports a known slope correctly, reproduces the closed-form cap
gradient `d/sqrt(R^2-d^2)` to four decimals, and is insensitive to step size.

## Why 6.4% was measured before and 8.8% derived

Neither was wrong; they answer different questions.

- `theGroundIsTheSphereItClaimsToBe` in `test/procgen/invariants.ts` does
  **not measure terrain** for its gradient clause at all — it computes
  `grade = d / GROUND_SPHERE_RADIUS` and compares that to `BUS_MAX_GRADE`.
  That is arithmetic wearing an invariant's clothes.
- The road clause walks the drawn road a metre at a time and takes the
  gradient **along the path's own tangent**. The road arcs roughly
  circumferentially, so most of the radial fall is across it, not along it.
  A tangential walk on a cap measures near zero; 6.4% is the along-road
  component, not the slope of the ground.
- The steepest-direction gradient is the honest number, and it is **larger**
  than both, because the rolling sine waves add to the cap rather than
  cancelling it.

## The map (identical on every seed)

`terrainHeight(x, z)` takes no seed. The ground shape is **the same on every
seed**; only which parts of it a child walks varies. Ring sweep at 0.5 m
spacing along each ring:

```
ring(m)  cap-alone%   mean%   worst%   worst deg   at (x,z)
   10       0.83      1.86     2.66      1.53     5.6,-8.3
   20       1.67      2.09     3.40      1.95   -14.1,14.1
   30       2.50      3.40     4.93      2.82    19.0,23.2
   40       3.34      4.39     6.38      3.65    39.5,-6.5
   50       4.17      4.74     7.56      4.32    49.4,-7.5
   60       5.01      5.21     7.28      4.16    59.6, 6.5
   70       5.84      6.20     8.43      4.82    67.9,16.8
   80       6.68      7.22     9.22      5.27   -28.7,74.7
   90       7.52      7.73     9.91      5.66   -29.6,85.0
  100       8.36      8.06    11.10      6.33   -99.7,-7.2
  105       8.78      8.38    11.81      6.73  -104.7,-7.2
  110       9.21      8.86    11.92      6.80  -109.8,-6.5
  117       9.80      9.67    11.73      6.69   102.4,56.5
  120      10.05     10.01    12.27      7.00    98.2,-69.0
```

Grid sweep, 0.5 m, 187 009 cells inside r <= 122 m:

**Steepest anywhere on the drawn disc: 12.78% (7.28 deg) at (99.5, -70.5),
r = 121.9 m.** Inside the park boundary band (101–107 m) the worst is
**about 11.8% (6.7 deg)**, e.g. (-104.7, -7.2).

Share of the disc by whole-percent bucket:

```
0-1% 0.3 | 1-2% 2.4 | 2-3% 4.5 | 3-4% 4.5 | 4-5% 9.5 | 5-6% 11.3
6-7% 13.3 | 7-8% 17.5 | 8-9% 15.9 | 9-10% 9.9 | 10-11% 8.0 | 11-12% 2.5 | 12-13% 0.2
```

So a fifth of the park is already over 9%, and the median cell is around 7%.

The rolling sine waves alone (cap switched off) reach **3.66%** at their
worst, and that is what stacks on top of the cap. The two do not add
everywhere — the worst ring values run roughly `cap + 2 to 3 points`.

## What was not done

- No walkable-area mask. These numbers cover the drawn disc, not only the
  squares `keepOutsFor` lets a child stand on. The walkable set is a subset,
  so the worst *standable* gradient is <= 12.78% and >= the worst on-path
  value, which was not separately extracted.
- **No screenshot.** I did not open a browser before being stopped, so there
  is no evidence here of whether it *reads* as a hill on screen. That
  question is unanswered and should not be inferred from these numbers.

## The lever, with numbers

For whoever picks the smaller radius. `horizon` is the ground horizon distance
for 1.2 m eyes, `sqrt(2*R*h)` — the thing the sphere exists to give.

```
  R      cap @105 m   cap @117 m   worst-with-waves   drop over 117 m   horizon
 400 m     27.20%       30.59%          ~34.2%            17.49 m         31 m
 500 m     21.48%       24.07%          ~27.7%            13.88 m         35 m
 600 m     17.77%       19.88%          ~23.5%            11.52 m         38 m
 800 m     13.24%       14.78%          ~18.4%             8.60 m         44 m
1000 m     10.56%       11.78%          ~15.4%             6.87 m         49 m
1200 m      8.78%        9.80%          ~13.5%             5.72 m         54 m   <- today
1600 m      6.58%        7.33%          ~11.0%             4.28 m         62 m
2000 m      5.26%        5.86%           ~9.5%             3.43 m         69 m
```

Two things to carry into the smaller-sphere work:

1. **`BUS_MAX_GRADE = 0.1` is already exceeded on the ground as built**, at
   12.78% worst and 9.67% mean at the road's 117 m reach. The invariant does
   not catch it because it never measures terrain. A smaller radius makes that
   worse by construction, so either `BUS_MAX_GRADE` is renegotiated with Jim
   or the bus's constraint stops being about the ground gradient.
2. **Fix the invariant in the same work.** Its gradient clause should sample
   `terrainHeight` in the steepest direction over the walkable footprint, not
   recompute `d / R`. A check that reproduces the constant it is checking
   cannot fail.
