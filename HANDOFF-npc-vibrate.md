# HANDOFF — npc-vibrate

**Task:** NPC children near the train stations sometimes vibrate violently.

## Root cause (measured, 28 July)

Prime suspect 1 — **double ownership** — confirmed, with a runaway on top.

`scripts/check-npc-jitter.mts` builds the real park headlessly and drives
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

`scripts/check-npc-jitter.mts`, wired into `npm run build` as `check:jitter`.
Two bounds on a child's *own* movement (measured after `carryPassengers`, so
boarding is not mistaken for a fault), over 9000 frames of the real park:

- own step <= 1.0 m in a frame (walking is 4.25 cm);
- speed <= 8 m/s (flat out is `NPC_WALK_SPEED * RUN_INTENT` = 4.46 m/s).

On this branch: worst own step 0.165 m, worst speed 4.959 m/s.
On 55b9b4f: 105.796 m and 3173.866 m/s, 12231 violations, first at frame 3985.

## State

- Branch `npc-vibrate`, worktree `.claude/worktrees/npc-vibrate`.
- Throwaway traces deleted. `npm run build` green, exit 0.

## Not done: the castle-floor clipping report

Investigated, **not reproduced, and not fixed** — handed on rather than guessed
at. Measured on this branch:

- `PoiGraph` has **46 nodes, all `space: 'garden'`** — zero castle nodes.
  `spawnNodes()` filters to `SPACE_GARDEN` and `nearest()` is confined to the
  asker's own space, so on today's `main` no child can ever be in the castle.
  ORDER-OF-WORK.md line 276 says the same: *"NPCs cannot get inside. That is a
  portal."* (The `World.ts` comment claiming they "walk the building's ground
  floor" is stale — it predates the deletion of the three dead indoor seeds.)
- No poi node anywhere in the park stands under a floor plate it cannot reach:
  for all 46, `sample(x, z, terrain)` == `sample(x, z, terrain + 3)`.
- 6000 frames of the real park: no child ever has a walk surface more than
  `BUILDING_STEP_UP` above the one they are standing on.

**The mechanism is nevertheless real and worth the next agent's first hour.**
`WalkSurfaces.sample(x, z, y)` only offers a surface within `BUILDING_STEP_UP`
(0.62 m) of your feet, and the interior plaza is `INTERIOR_GROUND_Y` = 1.200 m
below deck 0 (measured: deck 0 = 0.441, plaza = -0.759). So **any** character
who arrives on the castle ground floor below the deck can never step up onto
it and lives there for ever, sunk 1.2 m — which for a ~1.3 m child is exactly
"head poking out of the floor". `NpcCharacter`'s constructor seeds y from raw
`terrainHeight(x, z)`, ignoring the ground sampler, which is precisely how a
child placed indoors would arrive below the deck.

So: whatever route the family saw a child take into the castle is not on this
branch, but if one is ever added, that constructor is the bug waiting for it.
Reproduce by placing an `NpcCharacter` at an interior coordinate and running
`World.update`; fix by sampling the installed `GroundSampler` on spawn (and/or
letting a character below a floor plate step up onto it).
