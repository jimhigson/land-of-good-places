# HANDOFF — seed 451 does not build at park scale 1

- Branch `eng/seed451-crossing`, off `eng/sphere-ground-claims`.
- Model: **Opus 5 (1M context)**, chosen by the Overseer (Engineer default).

## Root cause, in one line

**The rail loop is allowed to run back within 3 m of itself, while a path needs
8.4 m to pass between two limbs — so the loop can wall off part of the park.**

The chain, measured, on seed 451 at scale 1:

1. `route.ts`'s `SELF_CLEARANCE = 3` — a bare constant, no derivation, no stated
   purpose. The loop ran back past itself for **35 m at 3.95-7.41 m**.
2. Station **Sunny Side** (railD 58.0) was placed beyond that wall. Its `lead`
   came out **8.15 m from its own rail point** — which is what the derivation
   intends and looks healthy — and **0.76 m from the nearest rail, at railD
   133.7, on the far side**: a limb 75.7 m away around the loop.
3. So the station's own spur had to cross the railway to reach its own platform.
4. Only **2 of 175** marched points on that loop admit a bridge at all (69
   deck-blocked at every width and angle, 49 ramp-short, 29 mixed, 26 inside a
   station window) — and none near the crossing.
5. `crossings.ts` threw, naming **railD 133.9 (37.9, -40.1)** — a coordinate 75 m
   around the loop and three modules away from the cause.

Control throughout: **Bluebell Halt** on the same seed. Its lead is 8.15 m from
its own rail point *and* 8.15 m from the nearest rail, 0.2 m along the loop —
the same limb. The old formula is right whenever the loop does not double back.

## What is on this branch, in two separable commits

### 1. Stations measured against the whole railway — CLEAN, no regressions

`clearStationDistance`'s park-side openness test checked plots and **not the
railway**; it now requires `RAIL_CORRIDOR_CLEARANCE` from any limb.
`stationLead` tries the authored `stand + park * 6` first and backtracks only if
that lands on the wrong side or inside the corridor, warning loudly if nothing
clears.

**9 of 10 seeds build (unchanged), every crossing on a proven site with a drawn
path through it. Bluebell Halt's lead identical to the millimetre.** Seed 451
still fails at this point.

### 2. `SELF_CLEARANCE` derived rather than chosen — FIXES 451, AT A COST

`RAIL_CORRIDOR_CLEARANCE` moves to `clearance.ts` (which `route.ts` can import;
`plan.ts` cannot be imported there — cycle) and `plan.ts` re-exports it, so no
caller changes. `RAIL_SELF_CLEARANCE = RAIL_CORRIDOR_CLEARANCE * 2`.

- **10 of 10 seeds build**, every crossing bridged, control passing.
- **It re-rolls every seed's loop, so every park changes.** Visible; Jim's call.
- `test:procgen` set diff against `origin/eng/sphere-ground-claims`:
  - **4 failures fixed** — coping stones on 131 and 326, grid axes and detour on 24.
  - **3 new failures**: `seed 24 > no tree grows into a wall`;
    `seed 326 > every railway crossing has a bridge you can walk to, onto and
    across`; `canonical > no drawn path ends in mid-air on a bridge`.

**Net −1, but three parks got a new defect, and zero tolerance does not net
off.** That trade is a decision, not an engineer's shortcut — the same reasoning
that said replacing a pool seed is not mine to make. Commit 1 is shippable on its
own; commit 2 needs a ruling.

## New invariant, proved red

`the railway leaves room to walk beside itself` — measures the built route,
threshold from the game (`RAIL_CORRIDOR_CLEARANCE * 2`), announces its reach on
every run to stderr.

**It could not be armed on the seed that motivated it**: with `SELF_CLEARANCE`
back at 3, seed 451's park does not build and all 94 tests **skip**. A skipped
test is not a red one. No test-file seed pinches below 8.4 at the old constant
(closest: seed 24 at 10.40 m). So it was armed directly, at threshold
`RAIL_CORRIDOR_CLEARANCE * 3` = 12.6 m on seed 24, built at
`SELF_CLEARANCE = RAIL_SELF_CLEARANCE`:

```
AssertionError: the railway runs back within 10.40 m of itself — railD 61
(22.6, -19.8) to railD 186 — against the 12.6 m a path needs to pass between
two limbs. Whatever is beyond that pinch is walled off from the park.
```

`test/procgen/seed-451.test.ts` added: 451 was in the pool with **no test file**,
which is exactly why `check:swept-bus` (ten seeds) found this and `test:procgen`
(five) structurally could not.

## Instruments (all controlled)

`diag-sites-sweep.mts` (why so few sites; asserts every kept site reads feasible
through the same explainer), `diag-which-leg.mts` (which drawn run crosses, by
run id and endpoints), `pinch.mts` (limb-to-limb gaps), `leadcheck.mts` (own rail
point vs nearest rail), `diag-seed-sweep.mts`, `diag-bridges.mts` (bridged, with
the `covers`-can-say-no control).

## The bridge ramp grade: diagnosed precisely, attempted, and reverted

### Root cause, measured on every crossing of seeds 326, canonical and 11

`WALKABLE_FLOOR = BRIDGE_RISE / MAX_RAMP_GRADIENT` = **10.57 m** assumes the
ramp descends `BRIDGE_RISE` (4.06 m). True only when the ground at the ramp's
foot is the ground at the crossing. **On a sphere it falls away**, so the
downhill ramp must descend `BRIDGE_RISE + the fall`.

| | downhill side | uphill side |
|---|---|---|
| mean grade built | **0.505 – 0.638** | 0.073 – 0.195 |
| budget | 0.384 | 0.384 |
| rise to the foot | **6.63 – 9.41 m** | ~1.4 – 2.9 m |
| run needed | **17.3 – 21.0 m** | 10.6 m |
| run sized | 10.6 m | 10.6 m |

The 1.6–2.0× shortfall in run is exactly the 1.3–1.66× overshoot in mean grade.
Every failure is downhill; the uphill side over-provisions and is harmless.

**`HUMP_BLEND` is NOT at fault and must not be touched to "fix" this.** Measured
peak/mean on those same ramps: **1.33, 1.33, 1.37, 1.37, 1.38** against the 1.333
it claims. The model of a hump is right; the length it is given is wrong.

### The attempt, and why it is reverted rather than shipped

Made the **real search**'s acceptance per-side and terrain-aware
(`rampRunNeededAt`, comparing each side's reach against
`(BRIDGE_RISE + fall) / MAX_RAMP_GRADIENT + margin`). Result:

**9 of 10 seeds stopped building**, every one with:

```
bridges: no walkable bridge fits at proven crossing railD ... The planner
proved this site; the real search refused it — find the drift between them
(issue #414).
```

Which is precisely correct and precisely my fault: `crossingPlanSolve.ts`'s
`SITE_RAMP_FLOOR` still uses the flat-park number, so the planner proves sites
the real search then refuses. **Two definitions of "how long must a ramp be",
and I made one of them right.** The existing error message caught it
immediately, which is the check doing its job.

### What finishing it actually requires, and the risk to weigh first

Both definitions have to move together, in one commit:
`bridgeFootprint.ts`'s `WALKABLE_FLOOR`/`MIN_RAMP_RUN`/`MIN_BRIDGE_HALF_LENGTH`
and `crossingPlanSolve.ts`'s `SITE_RAMP_FLOOR`/`probeReach` — a module-level
constant becoming a per-site, per-side, terrain-dependent quantity.

**The risk is site feasibility collapse, and it should be measured before the
work is started.** Roughly doubling the required run on downhill sides makes far
fewer points on the loop admit a bridge — and seed 451 already proves only
**2 of 175**. If a seed proves zero, `crossingPlanSolve.ts` throws "a park with
no way over the railway is invalid", and the cure is a warp vector or the seed
leaving the pool. `scripts/diag-sites-sweep.mts` counts feasible points per seed
and is the cheap way to answer that question first.

`MIN_BRIDGE_HALF_LENGTH` also feeds two-bridge spacing, so longer ramps mean
sites must sit further apart — a third consequence to measure, not assume.
