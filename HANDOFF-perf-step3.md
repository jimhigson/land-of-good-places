# HANDOFF — perf step 3 (don't update what isn't drawn)

Branch `perf-step3-undrawn`, worktree `.claude/worktrees/perf-step3`. Plan: `git show
origin/perf/frame-drops-2026-11:docs/perf/FRAME-DROPS-2026-11.md`, item 3.

## Findings so far
- Reptile cases: ALREADY gated — `ReptileHouse.update` only runs `hall.exhibits/stall/ride` while `inside`, and
  the hall is a lazy chunk since #749. Nothing to do; confirm with the instrument.
- Library children: ALREADY frozen while she is elsewhere — they are `NpcSystem` residents, and #362's
  `elsewhere` mark stops stepping them (`check:npc-presence` guards it). Library creatures gated on `inside`.
- Banquet: `Building.update` calls `banquet.update(elapsed)` every frame, everywhere → gate on drawn.
- Wild pets: `Building.update` calls `wildPets.update(context)` every frame, everywhere. Design intent
  (comment in Building.update): the roof "was already going" when she arrives. So: bank unseen time while
  undrawn, catch up (coarse steps, capped) on the first drawn frame (behind the iris).
- "Drawn" = three.js visibility chain reaching a Scene (one owner: what the renderer itself uses).

## Instrument
`scripts/check-undrawn-still.mts` — headless World, player in garden, counts objects under a hidden
ancestor whose transform / instance buffer changed frame to frame. Control: walk into great hall/roof.

## Measurement
Harness copy in scratchpad `step3/harness` (run.mjs points at this worktree). Ports: 5863 shipped, 5864 unminified.
