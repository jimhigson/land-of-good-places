# sb-castle-radius — anchor.reach measures drawn extent; castle radius derived

**Model: Claude Opus 5.5**, chosen by the structural-backtrack engineer. A replacement runs the same model.

Branch `fix/sb-castle-radius` off `origin/wip/sb-merge`. Worktree `.claude/worktrees/sb-castle-radius`.
Do NOT run `accept:parks` (the coordinator does, once, after merging).

## Task
1. `anchor.reach` (scripts/lib/parkFindings.mts) measured lump CENTRES; make it measure drawn extent
   (every vertex) in the plan frame; prove red on the castle.
2. Castle `boundingRadius` 19.3 typed in parkManifest.ts; derive from the castle's geometry owner.
3. Audit every anchor over seeds 0..15; RATCHET anchor.reach entries end at 0.

## Findings so far
- Seed 4 restart 3, vertex reach: castle plot-local 21.55 m (tower-roofs, the cone ring at y 10.6),
  world-XZ 20.53. Declared 19.3. = nudge 3.54 + turret corner hypot(12.225, 9.225)=15.315 + roof radius 2.45
  = 21.305, plus lean. Castle is axis-aligned (Frame.fromBearing(..., 0)), nudge direction varies with
  placement bearing, so the worst case over placements is the plain sum.
- Plan frame chosen: radial projection onto the sphere (vertex xz * R/|v - C|, C = (0,-R,0)) — the
  inverse of placeOnSphere: a thing's plan (x,z) is the foot of the up-line through it, which is what a
  tree's foot is compared against.
- Instrument committed 80f56b86 (vertex walk + unplaceFromSphere, ceil to cm — the old toFixed(1) let a
  <5 cm overrun read 0.0 and pass a zero allowance). Fix committed 405e05b1: CASTLE_PLOT_REACH in
  core/constants.ts = nudge 3.54 + max corner hypot 15.315 + CASTLE_TURRET_FOOTPRINT_RADIUS 2.45 = 21.31;
  manifest reads it. Footprint radius moved to constants, re-exported from layout.ts.
- Seed 0 r2 (pre-fix) plan-frame: building 20.54 (tower-bodies foot), hotel 6.73 (world-XZ 9.47 — the lean,
  why plan frame matters), ballPit 6.68, ferris 6.73, dodgems 9.47, waterFight 15.84.
- In flight: base sweep (detached worktree sb-castle-radius-base with the instrument copied in),
  red proof check:park seed 4 r3 on base, then fix sweep. Outputs in scratchpad sweep-{base,fix}.*.
- Probe: scratchpad `probe-reach.mts`; sweep of 16 seeds in `sweep.txt` there.

## Base sweep done (pre-fix, recorded restarts, plan frame)
building 19.30 declared: 20.13–20.69 on all 16 seeds (tower-bodies foot every time) — the only overrun.
hotel 9: 6.73–6.88 · ballPit 9: 6.68 · ferris 13: 6.58–6.73 · dodgems 19: 9.37–9.48 · waterFight 19: 15.84–16.24.
Red proof (base + new instrument), `LGP_SEED=4 LGP_PARK_RESTART=3 check:park`: exit 1,
`anchor.reach:building: 1.33, recorded at 0` (drawn 'tower-bodies' 20.63 m at plan (27.9,-15.8)).
Seed 4 restart 2 no longer builds on this base (DuckBarRefusal) — the 20.87 was an older base.
Next: fix sweep, check:park 0/4/11, park:attempt 4/3.

## Fix sweep done (radius 21.31, recorded restarts)
building 20.13–20.69 on 15 seeds (≤ 21.31, margin 0.62). Others unchanged. Seed 13 restart 0 no longer
builds (DuckBarRefusal in railRace hazards) — the layout moved; accept:parks re-takes it (coordinator).
Next: check:park 0/4/11 + park:attempt 4/3 running (scratchpad verify.log).

## Verified — done
check:park (recorded restarts) seeds 0/4/11: exit 0; building drawn 20.54 / 20.55 / 20.49 vs 21.31.
park:attempt 4/3: base = rejected only by `anchor.reach:building: 1.33`; fix = anchor.reach clean, now
rejected by "the Sky Cruiser stands on its own supports" (103.5 m unsupported) — the layout moved; the
coordinator re-runs accept:parks. tsc both projects exit 0. Base worktree removed.
