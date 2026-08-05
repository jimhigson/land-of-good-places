# HANDOFF — climb-wave

Branch `feat/climb-wave-and-npc-climb`, worktree `.claude/worktrees/climb-wave`.
GitHub #120 / board task #10. Browser NOT owned — build-verify only.
**No PR until the Overseer says.**

## Scope correction, found before writing any code

#120 is two asks. **The second one already shipped.**

> "NPCs should also climb trees (new activity on the existing climb zones)."

`src/entities/npc/activities/treeClimb.ts` landed in **PR #84** (`b764880`,
28 July), fixed in #90. It is a full `Activity` — budget, cooldown, up/peek/down
phases — instantiated at `wanderDriver.ts:149` and posed by
`TreeClimbing.updateNpcClimbs`. Nothing to do; I did not touch it.

So this branch is **only the player's wave**.

## The problem that shaped the design

A climber peeks with her **head at `canopyTopY` and everything else hidden**
(`TreeClimbing`, "Body hidden, head out"). Three things followed:

1. **The waving arm has to stay drawn.** `hidePlayerBody` now spares
   `model.rightArm` as well as the head. Her shoulder stays buried, so what
   appears is a hand and some forearm beside a head — the cartoon read.
2. **She has to rise.** *Her arm cannot reach above her own head.* Shoulder at
   0.72, head at 1.36 (`kid.ts`). Measured on the real rig at the real wave
   angle across the whole waggle, the hand tops out **0.303 m below her head**,
   while the canopy at her perch is only ~0.18 m below `canopyTopY`. A raised
   arm alone is ~0.12 m *inside the leaves* from every bearing. `WAVE_RISE = 0.3`
   lifts the whole child; worst clearance on the canonical park is 0.176 m.
3. **The pose belongs to `Player`, not `TreeClimbing`.** `Player.update`'s
   riding branch rewrites *both* arms every frame (`Player.ts`, the hold-on
   pose) and returns — an arm posed from outside survives exactly one tick.
   `Player.setClimbWave(0..1)` blends over that pose instead, using the crowd's
   own wave numbers so one gesture reads across the park.

**Do not "simplify" this by posing the arm from `TreeClimbing`.** It will look
correct, typecheck, and do nothing.

## Timing (the charm, per the brief)

`WAVE_FIRST_DELAY 0.85` → first wave almost immediately (the point of climbing
is being seen to have done it), then `WAVE_CYCLE_SECONDS 4.4` with
`WAVE_DURATION_SECONDS 1.7`. She turns to the camera to wave
(`CAMERA_FACING = CAMERA_YAW_DEGREES * DEG`; forward is `(sin, cos)` and the
camera sits at `(sin yaw, cos yaw)`) and drifts back to her peek facing after.
That is a **scripted pose, not a control** — nothing here reads the stick, so
the CONTROL RULE is untouched.

## `npm run check:climb-wave`

New, and in `build`. It exists because the wave's visibility depends on four
numbers in four files that never reference each other, and the only symptom of
breaking it is *a wave you cannot see* — which no other check would catch and
which I could not eyeball (QA holds the browser).

It measures rather than computes: poses a **real** kid and takes the arm's world
bounds through the whole waggle, then walks the **real** generated park and
evaluates the **real** canopy ellipsoids over every climbing spot, at all 72
approach bearings.

It corrected me immediately: I had derived the hand as ~0.25 m below her head;
it is 0.303. Trust it over any arithmetic in a comment, including mine.

## PR #188 (swappable model) — what I did about it

`playerHiddenParts` holds children of the player's model, and #188 can replace
that model mid-climb. It now records **which model** it collected from
(`playerHiddenModel`); on restore, a mismatch means the refs belong to a
discarded model, so they are dropped and the live model is left alone (a fresh
model is already fully visible). `setClimbWave` is on `Player`, which owns its
own model reference, so the wave needs nothing further.

## Also fixed (pre-existing, one line)

`updatePlayerClimb`'s `if (!tree)` bail cleared the phase but left her **hidden
and still `riding`** — invisible and unable to move. It now restores the body
and ends the ride. Reachability not established; it was free to make safe.

## State

- [x] wave implemented — `559123a`
- [x] `check:climb-wave` + build wiring — `8ad4816`
- [x] `!tree` bail fix + this handoff — see final commit
- [x] `npm run build` exit 0, with `check:climb-wave` inside it
- [ ] PR — **hold**

## Visual QA still needed (no browser)

1. Climb a tree: after ~0.85 s she swings round to the camera and waves, then
   settles back to her peek facing; repeats every ~4.4 s.
2. The **hand is visible above the leaves** through the whole wag — the one
   thing `check:climb-wave` bounds numerically but nobody has actually looked at.
3. The rise reads as hauling herself up, not floating.
4. Climb down mid-wave: arm returns to normal, body reappears, no stuck pose.
5. An NPC climbing nearby still looks right (untouched, but shares `climbPose`).
