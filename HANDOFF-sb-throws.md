# HANDOFF: sb-throws

- Model: Claude Opus (chosen by the #706 structural-backtrack agent). Branch fix/sb-throws off wip/sb-merge 6de631e0.
- Tasks from #706: (1) seed 15 r7 TypeError fixed at cause + park-attempt marks TypeError/RangeError broken
  (by class); (2) worldPhase railRaceBuilder road-only TrestleRefusal -> refusal; (3) slideArchClear and
  planExit refuse instead of silently accepting. Before/after accept:parks 0-15 --fresh (no --write).
- before run: worktree sb-throws-base, scratchpad t/before.json.

## (1) seed 15 r7
- Stack: paths.ts repairRouteOffBridges -> routeClearsArchFeet -> routeCurve/pathDivisions -> three getLength.
- Detour points A,B,A (B 0.86 m off): easeJogsAndStubs dropped B as an end stub -> A,A -> 1 point -> crash.
- Fix: stub drop only when the leg left is >= COINCIDENT; drawnPolyline re-collapses after easing;
  routeCurve throws RangeError on < 2 drawn points.
