# HANDOFF — exhibit camera (Reptile House over-shoulder shot)

Branch `feat/exhibit-camera`, worktree `.claude/worktrees/exhibit-camera`.

## Ask
Jim: exhibit reactions are hard to see zoomed out — the camera should come
down to an over-shoulder view of the animal while it reacts; eases back when
the reaction ends or she moves. Shot solved against occlusion (raycasts,
several candidate eyes). Check `check:exhibit-camera` in a shard, proved red.

## Design (decided)
- Reuse IsoCamera's existing shot API: `setFocusOverride` (via Game's
  `focusClaim` arbitration), `setShotOverride(yaw, pitch, distance)`,
  `setZoomTarget` — the arrival/keychain precedent. No new camera mechanism.
- `src/world/reptileHouse/exhibitCamera.ts`: solver (candidate eyes behind her,
  raycast eye→animal points against the hall + her body, glass see-through)
  and a director that eases a pose (yaw/pitch/log-distance/zoom/focus,
  smoothstep) in and out; `apply(camera)` is the one wiring both Game and the
  check call.
- Each `Exhibit` gains `subject()` — a world Box3 of its animals.
- Trigger: `ctx.greet(id)` (already called by every exhibit's primary chip).
- Cancel: manual move, jump, she moves >0.25 m, rides, leaves hall.

## Status
- [ ] solver + director
- [ ] Game wiring
- [ ] check:exhibit-camera + red proof
- [ ] PR + preview screenshots
