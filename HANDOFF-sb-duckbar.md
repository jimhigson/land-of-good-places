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
