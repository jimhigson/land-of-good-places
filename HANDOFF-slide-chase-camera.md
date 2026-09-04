# HANDOFF — the slide's chase camera (#514 framing, #516 clipping)

**Model: Claude Opus 5 (1M context)** — chosen by the Overseer when it assigned
this work. Role: **Engineer** (I reviewed #474/#512/#515 earlier in the same
session; I authored neither #514 nor #516).

Branch `fix/slide-chase-camera`, worktree `.claude/worktrees/eng-camera-514`,
based on `origin/main` `10fb7c2d`. Node 26.7.0, exit codes from each run's own
log.

## The constraint I was told not to assume — established, with a quote

ARCHITECTURE.md's "One camera angle, forever" binds **`IsoCamera`**, the park's
overworld camera, and **explicitly exempts this one**:

> Exempt from all of this: anything with its own dedicated camera — a
> mini-game's play view (dodgems, rail racer, the space ferris wheel), and any
> **future ride camera**. Those are separate rigs solving a separate problem and
> are untouched by any of the above.

So the fixed `CAMERA_PITCH_DEGREES`/`CAMERA_YAW_DEGREES` rule does **not** bind
the slide's chase camera. Pitching or moving this rig breaks no architectural
rule. (GAME_DESIGN.md #16 "camera never rotates" is about the same overworld
rig — the ride cameras already pitch and bank freely.)

`Building.ts`'s own doc on `CHASE_EYE` invites the change:

> **Reasoned, not seen** — there was no browser in either session that touched
> it. This is the first number to move if the shot is wrong.

## #514 root cause — MEASURED, not inferred

`CHASE_EYE = { x: 0, y: 1.62, z: 4.35 }`, an offset from the seat on
`eyeMount` (which is rotated `PI`, so **+z is behind the rider**).

Canonical seed, wired run, nearest companion (Little Mouse), all nine rasters:

| raster | ahead of lens | below axis | angle below | half-fov |
|---|---|---|---|---|
| 1 | 1.07 m | 0.99 m | **42.7°** | 30.0° |
| 2 | 1.07 m | 0.73 m | **34.3°** | 30.0° |
| 3 | 0.99 m | 1.00 m | **45.4°** | 30.0° |
| 4 | 1.06 m | 0.94 m | **41.4°** | 30.0° |
| 5 | 1.06 m | 0.88 m | **39.5°** | 30.0° |
| 6 | 1.08 m | 0.86 m | **38.7°** | 30.0° |
| 7 | 1.09 m | 0.84 m | **37.7°** | 30.0° |
| 8 | 1.11 m | 0.82 m | **36.5°** | 30.0° |
| 9 | 1.07 m | 0.83 m | **37.9°** | 30.0° |

**The pet sits 34°–45° below the camera axis against a 30° half-fov.** It is
outside the frustum by 4°–15° on every single raster. That is the whole of
#514, and it is arithmetic, not bad luck — which is why every park has it.

### Why, in one sentence

**The camera sits *inside* the line it is meant to be filming.** It is 4.35 m
behind the child; the line of companions starts `PET_SLIDE_LEAD` = 2.73 m
behind her and runs back ~2 m per animal. So the nearest pet is only ~1.05 m
*in front of* the lens and ~0.9 m *below* it — the camera is flying directly
over the top of it — and the second and third companions are **behind the lens
altogether**.

At 1.07 m range a 0.9 m drop is 40°. No amount of aiming fixes it, because the
line straddles the camera.

### What the fix has to be (not a nudge)

Same shape as #507: **ask the thing that was actually built.** The rig must
place itself from (a) how long the line actually is and (b) what it has to keep
inside the frustum — rather than a fixed 4.35 m chosen for a rider with no
companions at all. Arithmetic floor for the current geometry: to bring a 0.9 m
drop inside 30° needs ≥1.56 m of run, i.e. the lens must sit ≥1.56 m behind the
**last** body it must show, not 1.05 m behind the first.

**Do not lower `IN_SHOT_FLOOR` (0.95) or `PET_FRAME_FLOOR` (0.01)** — the pet
really is out of shot.

## #516 — the issue's named culprit does not survive measurement

**#516 says the camera "enters the ball-pit rim". Three independent pieces of
evidence say it is not the rim.**

1. **Per-frame sampler, every ridden frame, every shot kind** (seed 346):
   `camera nearest the pit rim 6.13 m on a chase shot (0 frames INSIDE it)`.
2. **The trackside eyes, measured at plan time** (`scripts/measure-slide-camera.mts`,
   seed 346): three trackside eyes, rim clearances **19.78 m, 26.35 m, 41.92 m**,
   none inside, nearest pit surface of any kind >2 m for all three.
3. **The screenshot's own colours.** The rim is `PALETTE.markerPink` and the
   bowl `stonePinkLight`. In QA's frame the pink rim band and the pale bowl are
   clearly visible **in the distance at the upper right**, while the thing
   filling the left two-thirds of the frame is a flat **tan/sand** surface —
   a different object, much nearer.

So the defect is real (that frame is unmistakably a camera buried in geometry)
but **the prop named in the issue is not the one doing it**. Fixing the rim
would have fixed nothing, and a run of any rim-based check would have gone
green while a child still lost her view.

This is why the next instrument asks the scene rather than a named prop: a ray
fan from the lens each frame recording the **nearest object of any kind and its
name**. Naming the mesh is the difference between fixing the camera and fixing
the wrong prop.

### A trap worth recording

My **first** rim sampler sat inside the `kind === 'chase'` branch, so it could
only ever have measured one of the ride's two cameras. It reported 6.13 m and
0 frames inside — the same numbers the corrected sampler later produced, which
is luck: it was right by accident while being structurally unable to see a
trackside eye at all. What caught it was the contradiction with QA's frame, not
the number.

## #516 — extent still unmeasured

Camera position enters the ball-pit rim near the bottom of the chute on seed
346. Extent unknown (one frame, one seed). Next step: sample the camera's world
position every frame down the descent and test it against the pit rim / garden
geometry, across the pool.

**Working hypothesis, to be tested not assumed:** the same defect — the rig
never asks what is in the way — so a placement solve that also refuses solid
ground fixes both. That is the Overseer's "the fix for one may be the fix for
both", and it is a hypothesis until measured.

## Instrumentation

`scripts/check-pet-slide.mts` carries `LGP_SHOT_DEBUG=1` (taken from
`origin/fix/pet-slide-inshot`, which diagnosed #514) **extended by me** to print
camera-space geometry: `ahead`, `below-axis`, the angle, and the camera's
half-fov. That extension is what turned "the ndc is negative" into "40° against
a 30° half-fov", and it is the number the fix has to move.

Trap inherited from that branch, still true: `Raycaster.setFromCamera`
extrapolates past the frustum, so `camera meets` is meaningful **only** when
`OFF-TOP/BOTTOM` is absent.

## Gates

`check:pet-slide` takes **no seed sweep** — one park per invocation, canonical
in the `check` chain. A green chain proves nothing here; the pool must be swept
by hand (this is #510's gap).

## Status

#514 root-caused and measured. #516 not yet measured. No code change yet.
