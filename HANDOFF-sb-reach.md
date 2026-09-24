# HANDOFF sb-reach (model: Claude Opus 5.5, chosen by the structural-backtrack engineer)

Task: anchor.reach:waterFight forces restarts (built extent > declared 19 m).

## Finding (09:30)
- Furthest lump is the water-gun rack in `src/minigames/waterFight/plot.ts`,
  placed at `door + (-2.6, -1.4)` (fixed world-axis offset). The door
  (`anchor.entrance`) is per-park: `parkLayout` puts it on the rect edge facing
  the park middle + 1.4 m stand-off, so its local distance ranges 12.4..17.7 m
  with bearing; the rack then lands up to ~20.6 m out, OUTSIDE the plot.
- Seed 14 r0 on this tree: rack at local 19.17 m (world 18.0 after the 20 deg lean).
- Plan: stand the rack inside the plot footprint by construction (inward from
  the door along its bearing, clamped into the rect), keep 19 m.
- Probe: scripts/probe-reach.mts (scratch, do not commit).

## Progress (10:10)
- Fix committed: rack inset along door bearing + clamped into rect (plot.ts). Declared 19 kept.
- Before (probe): 1 r2 reach 19.06, 9 r1 19.74 (rack). After park:attempt: no anchor.reach on
  1:2 9:1 11:1 12:9 14:1 1:8 13:26 20260728:0 2:0; other failures there to compare with base.
- Base worktree .claude/worktrees/sb-reach-base (detached 714dca83) running base attempts,
  then digests 0..15 base vs fix (scratch sb-reach/chain.sh). Remove base worktree when done.
- tsc + typecheck:test exit 0.
