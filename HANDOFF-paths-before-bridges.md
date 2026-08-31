# HANDOFF — #414, paths laid out before the bridges that get built

Branch `fix/paths-planned-before-bridges`. Jim, third report:

> "this seems like a failure of path layout to me. Are we plotting the paths
> and then choosing which to upgrade to bridges? Another path shouldn't join
> into a mid-ramp bridge"
> "there is also a path that runs into the side of the bridge — basically runs
> into a solid wall"
> "path finding needs to include bridges from the start, not as an afterthought
> to add to an existing path layout"

## Measured — `scripts/measure-bridge-path-conflicts.mts` (this branch)

`node --no-warnings --import ./scripts/ts-extension-resolver-register.mjs \
  scripts/measure-bridge-path-conflicts.mts 20260728 2 5 11 18`

Baseline on `origin/main` @ 6d475dab:

| seed | proven bridge sites | level sites | crossings | bridges built | built on a **level** site |
|---|---|---|---|---|---|
| canonical (20260728) | 4 | 3 | 2 | 2 | 0 |
| 2 | 0 | 7 | 3 | 1 | **1** |
| 5 | 3 | 6 | 3 | 2 | **1** (d=130) |
| 11 | 3 | 3 | 4 | 2 | **1** (d=84) |
| 18 | 1 | 6 | 2 | 1 | **1** (d=104) |

**Four of the five seeds build at least one bridge on a crossing the planner
offered only as a LEVEL crossing.** The site counts reproduce #392's table
exactly. So the ordering fault is live on 4/5 seeds, not just seed 2.

## The mechanism, confirmed in code

`pathGraph.ts`'s `drapePathsOverBridges` lifts **every** drawn path vertex a
bridge's `pavingHeightAt` covers — not just the run the bridge was built for.
So a foreign connector crossing a bridge's footprint is *drawn climbing the
ramp flank and stopping at the parapet*. Foreign runs lifted onto a bridge
(excluding the bridge's own run):

- seed 11, bridge d=84: a foreign run lifted **2.77 m** at (-45.4, 22.7)
- seed 18, bridge d=104: a foreign run lifted **2.72 m** at (0.2, 30.4)
- seed 5, bridge d=130: a foreign run lifted **1.10 m** at (33.4, -1.7)

## Status

- [x] worktree, dev server on 5417
- [x] baseline measured, all five seeds
- [ ] visual repro from a player's eye (Overseer's order #1)
- [ ] confirm which foreign runs are genuine second paths vs the far half of
      the bridge's own crossing leg (run-id split at a graph node)
- [ ] measure WHY `bridgeCandidateAt` proves nothing where `planReal` builds
      (a lead, not a finding)
- [ ] report plan before deleting the opportunistic pass

## Environment

Dev server port **5417** (`--strictPort`). Kill by PID only.
