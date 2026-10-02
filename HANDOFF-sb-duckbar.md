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
