# HANDOFF: sb-duckbar

- Model: Claude Opus (chosen by the #706 structural-backtrack agent, which spawned this one).
- Branch: fix/sb-duckbar, from origin/wip/sb-merge. Worktree .claude/worktrees/sb-duckbar.
- Task: `DuckBarRefusal` thrown from `railRace/simulate.ts` `barPlanDecision` during the
  world phase (`new RailRace` -> `scheduleForLevel`) ends park attempts. Make the deciding
  decision refuse with blockers instead, prove it, report to #706 via SubagentHandback.
- Do not commit src/world/acceptedRestarts.ts.

## Findings
- Bar plan is a pure function of the two planned rings (RAIL_RACE_PLAN), which are
  plan-phase data (layout boundary + booth bearing + cruiser keep-offs for the arch).
- `scripts/measure-duck-bars.mts LGP_SEED= LGP_PARK_RESTART=`: plan only, prints reach/physics refusals.

## Root cause (measured, scripts/measure-duck-bars.mts)
- Per park the cost of the bar decision is <1 s; plan solve is the cost (cruiser dominates).
- Reach refusals dominate: walk-past ring (scale 1) refuses ~13-26 of 49 slots per lane
  (inner lanes 1,2 most) vs 4-8 on the race ring: undulation heights are shared, not scaled,
  so park-scale bars sit at neighbour-lane height far more often. Window is 42 slots for 40
  bars with the 2-slot lane gap: 2 spare slots. Whether a layout exists depends on where
  the arch (startDistance) puts the window against the undulation phase.
- Seed 5 r0: ring 591.9 m; layout re-draws keep ring length, move the arch (252.6, 409.6,
  264.7 refused; 4th draw fits). So the deciding decision is the arch datum = layout's booth
  bearing (+ cruiser/exit keep-offs when they push it).

## Fix (7fe435ad, f6cf6b2b)
- parkPlan.ts: coarse builder `railRaceBars` after train; refuses with
  consumed = RailRaceRoute.archDecidedBy (layout; + cruiser/train if their keep-offs pushed the arch).
- simulate.ts: raceBarPlanDecision reads planPart('railRaceBars'); planRaceBars exported.
- route.ts/plan.ts: KeepOff.owner, slideArchClear reports who pushed the arch.
- Invariant `duckBarsAreTheLayoutThePlanDecided` (+ ParkFacts.duckBarPlan).
  Seed 15 r0 clean: passes. Mutation A (ride ignores plan refusals): 28 complaints, red.

## Runs
- before: worktree sb-duckbar-base (origin/wip/sb-merge ff44be3e), scratchpad before.json/log
- after: worktree sb-duckbar-after (f6cf6b2b), scratchpad after.json/log

## v2 (f6680752..54a07346): the arch station is the decision
- Arch scan (base, seed 5 r0): 75/121 arch stations fit the bars; booth station does not, +5.25 m does.
  Seed 15 r0: 43/121. So railRaceBars' attempt n = n-th clear arch station (route.ts archStation);
  attempt 0 = arch as always. Exhausted -> refusal consumed archDecidedBy (layout [+cruiser/train]).
- RAIL_RACE_PLAN is now a view of planPart('railRaceBars').plan (no memo).
- stepRider finish uses raceDistance(route) (was the decided plan: read-before-decided in the builder).
- pathGraph deps += railRaceBars (round-robin ran pathGraph while railRaceBars retried).
- Seed 5 r0 now: refused stations 0..11, placed at 12, park builds (other measures fail as normal).
- check:solve-cost prints unbudgeted plan features (railRaceBars has no budget row: no CI reading).
- before run (base) shows DuckBarRefusal on seeds 3,4,5,8,9 (...) as build failures.

## Result (accept:parks 0-15 --fresh, no --write)
- before (wip/sb-merge ff44be3e): 61 attempts, 19 ended by DuckBarRefusal (seeds 3:4, 4:1, 5:3, 8:2, 9:2, 13:4, 15:3).
- after (54a07346, same base): 44 attempts, 0 DuckBarRefusal. Seeds 3 9->2, 5 6->3, 13 9->2.
- Mutation A (ride ignores plan refusals) seed 15 r0: new invariant 28 complaints. Mutation B (no plan
  builder, old world-phase solve): 'plan never placed railRaceBars'. Clean seed 15 r0: passes.
- Other throw seen: seed 15 r7 "Cannot read properties of undefined (reading 'x')" (before and after).
- DONE; rebased onto wip/sb-merge 90c0237a.
