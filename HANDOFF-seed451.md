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
