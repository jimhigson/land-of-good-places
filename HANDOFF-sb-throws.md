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

## State (b3b623d6) — all three tasks done, committed, pushed
- (1) paths.ts stub guard + re-collapse + routeCurve RangeError; scripts/lib/attemptError.mts buildBug
  (class + cause chain) -> park-attempt `broken`. test/attemptError.test.ts. Mutations red: stub guard
  removed (1 fail), classify-by-message (4 fail). e2e: old paths.ts at 15 r7 -> broken TypeError; fix -> accepted.
- (2) worldPhase railRaceBuilder always refuses (blockers = refusers); plan road builder asks
  track.ts barSlotWithNoSupportRoom (shared marchTrestle) of both rings, consumed railRaceBars.
- (3) slideArchClear -> at null; planExit -> refused; railRaceBars refuses with decidedBy.
  test/railRaceRefusals.test.ts (seed 15 r0, 10 s). Mutations M1-M3 red. M4 (no room ever) hangs the
  solve (endless refusal) rather than failing fast: not a usable red proof; noted.
- before accept 0-15 (6de631e0): 38 attempts; only build throw 15 r7. After: targeted seed 15 only.
