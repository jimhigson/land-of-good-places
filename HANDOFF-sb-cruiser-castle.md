# HANDOFF: sb-cruiser-castle

Model: Claude Opus 5.5 (chosen by the structural-backtrack engineer). Branch `fix/sb-cruiser-castle` off `origin/wip/sb-merge`.

## Root cause (measured, seed 3 restart 3)
Instrumented `cruiserRouteSearch`: tier=escalated returned a 267.0 m loop with
`report.satisfied=false`; `crossesTheCastle(plan)` false, plan span null, built span null.
`railRouteSearch` hands back its first solved loop unsatisfied when every pose fails
`satisfies`; the cruiser ladder took the escalated result "whatever it says" (and fell
back to tier 1's unsatisfied loop if escalated threw). No plan-vs-built mismatch.

## Fix
- `cruiserRouteSearch` (coaster/route.ts): throws `RailRouteUnsolvable` (missedTheCastle) when
  the escalated/rescue tiers end unsatisfied; parkPlan's cruiser builder already turns that
  into a refusal (consumed layout).
- parkPlan cruiser builder: refuses if the built `route.castleSpan` is null (same
  `spanInsideCastle` the search asks of the plan).

## Status
- [ ] after-runs: s3 r3/r4/r5, s4 r8, s3 r0, canonical 20260728
- [ ] red proof, check:cruiser-solves, check:cruiser-clearance, tsc
