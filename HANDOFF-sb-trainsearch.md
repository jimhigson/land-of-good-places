# HANDOFF — sb-trainsearch: why seed 6 re-runs the train search 34 times

Model: Claude Opus 5.5 (chosen by the structural-backtrack engineer).
Branch: fix/sb-trainsearch (from origin/wip/sb-merge). Worktree: .claude/worktrees/sb-trainsearch.
Scratch: /private/tmp/claude-501/-Users-jim-dev-landOfGoodPlaces/92acae52-e71b-43c9-a76b-92e2c76ea5d3/scratchpad/sb-trainsearch/

## Task
Seed 6 restart 5: plan 650 s CPU, train 507 s (48.7M pieces, 34 unwinds). Root-cause
which refusals unwind into the train, fix at cause (builder alternatives > accurate
`consumed` > cheaper train search). Measure plan CPU for seeds 0..15 before/after;
confirm park:attempt accepts at recorded restarts.

## Status
- [ ] baseline trace seed 6
