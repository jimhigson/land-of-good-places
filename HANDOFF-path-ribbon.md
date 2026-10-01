# HANDOFF — path-ribbon (fix/path-ribbon, fast-forwarded onto origin/wip/sb-merge @ 2aacff7f)

Model: Opus 5.5, Engineer, spawned by the Overseer. Resumed 1 Oct: finish part 1 only (part 2 moot).
The ribbon fix itself is already on wip/sb-merge (merged 029da0e5, extended with repair discs).
This branch adds only: noDrawnPavingFacesTheGround no longer sets aside steep (>60 deg) triangles.

Proof plan / status (logs: scratchpad/path-ribbon/):
- green 0..15 at accepted restarts, no set-aside: inv-nosetaside.log (running)
- red on base: worktree .claude/worktrees/path-ribbon-mut, LGP_RIBBON_MUTATION=1 makes ribbonEdges
  plain offsets (pre-fix construction; chord across + sliver filter kept)
- then: test:procgen name+message diff vs sb-merge with planted control, check:coplanar sets,
  check:park 0..15, determinism, fold frames, PR against wip/sb-merge.
