# HANDOFF — paving-rail

- Model: Claude Opus 5.5 (1M), assigned by the Overseer. Engineer. Branch fix/paving-rail; lead a52ae9484877226d6 merges into wip/sb-merge.

## fix/paving-rail (off fix/paving-clear)
- Measure noDrawnPavingInTheRailCorridor: paving cells within FENCE_OFFSET of the rail, except bridge-carried and a station platform's open side (STATION_GAP window, platform side). Control `CTRL_MODE=rail` (scripts/controls/paving-under.mts) red on seed 12 r0: 10.93 m².
- Before (r0): seed 10 ~42 m² (connector-stall.facePaint-station-0, spur-station-0 up the track), seed 1 ~13 m² (spur-stall.keychain / connector-stall.keychain-station-0), seed 12 clean.
- Fix: paths.ts inRailCorridor in routeClearsSolids (spur streets, fallback, connectors) + parkPlan refusal. After (r0): seeds 1, 10, 12 pass, with 1–4 in-process layout redraws per park from the refusal.
- Skipped locally: accept sweep, procgen diff, check:park, coplanar, determinism, frames (CI).
