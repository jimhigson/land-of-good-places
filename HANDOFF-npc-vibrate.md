# HANDOFF — npc-vibrate

**Task:** NPC children near the train stations sometimes vibrate violently.

## Root cause (measured, 28 July)

Prime suspect 1 — **double ownership** — confirmed, with a runaway on top.

`scripts/measure-npc-jitter.mts` builds the real park headlessly and drives
`World.update` at a fixed 60 Hz, sampling every child's x/z three times a frame
(start, after `ParkTrain.carryPassengers`, after `NpcSystem.update`).

Jasper boards at Bluebell Halt and the moment the train pulls out:

```
f3979 carry (-45.733, 0.304) -> (-45.690, 0.283)      <- train writes the seat
      npc.update in  (-45.690, 0.283) v=(0.00, 0.00)
      npc.update out (-45.752, 0.317) v=(-1.86, 1.03) <- collision.resolve, then
                                                         the velocity rewrite
f3999 carry (-44.818, -0.188) -> (-44.770, -0.217)
      npc.update out (-45.748, 0.323) v=(-29.34, 16.20)
f5999 total step 73.108 m in one frame
```

Chain:

1. `ParkTrain.carryPassengers` writes a rider's x/z, on the seat — which is on
   the track, i.e. **inside the rail-exclusion fence colliders**
   (`collision.isClearCircle(-45.69, 0.283, 0.5) === false`).
2. `NpcCharacter.move()` still runs for a rider. `collision.resolve` ejects them
   ~0.07 m sideways off the train.
3. `move()`'s "trust the resolved position over the intended one" rewrite,
   `velocity = (position - previousPosition) / dt`, reads that ejection — and,
   from then on, the train's own per-frame write — as speed the child asked
   for. `previousPosition` was set to the *train-written* seat, so the whole
   gap between the seat and the fence exit point becomes velocity every frame.
4. Positive feedback: 1.9 m/s on the first frame, 29 m/s twenty frames later,
   ~2200 m/s after thirty seconds. The child ping-pongs between the seat and a
   pinned point beside the fence — **73 m per frame, sign alternating**.

Not an LOD artefact (the far/half-rate path only sets the step size).

## Fix

`NpcCharacter` gains `setCarriedPose(x, z)` + a `carried` latch, mirroring the
existing `beginClimb/setClimbPose/endClimb` trio: while a ride is carrying a
child, `move()` does not run at all; `rideAlong()` settles them onto the
carriage floor (a registered `MovingPlatform`) and keeps the rig in step.
`ParkTrain.carryPassengers` calls it instead of writing x/z directly — 2 lines,
to keep out of PR #101's way.

## Invariant

`scripts/measure-npc-jitter.mts` is kept and wired into `npm run build` as
`check:jitter`: no child may move more than 0.35 m in one 60 Hz frame across
9000 frames of the real park.

## State

- Branch `npc-vibrate`, worktree `.claude/worktrees/npc-vibrate`.
- `scripts/trace-one-child.mts` and `scripts/_probe.mts` are throwaway; delete
  before pushing.
