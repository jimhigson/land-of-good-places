# Handoff — the eye-height owner, and the arrival-camera lineage analysis

- **Branch**: `feat/eye-height-owner`, off `origin/main` at `b581462d`.
- **Worktree**: `/Users/jim/dev/landOfGoodPlaces/.claude/worktrees/eye-height`
- **Model**: Opus 5 (1M context), chosen by the Overseer. A replacement runs the same.
- **Invisible to a player**, and Jim did not ask for it, so it merges on review
  plus QA without him.

## 1. The owner

`KID_EYE_HEIGHT = 1.5164` in `src/art/models/kid.ts` — where a standing child's
eyes are, above her feet.

**Measured, not derived**: `kidEyeCentre(1)` taken into world space through the
real `crown` group it is written in. Both eyes identical. Never reconstructed
from `KID_HEAD_HEIGHT` plus `HEAD_TILT`, which would be a second description of
a surface `kid.ts` already owns and which that file explicitly refuses to write.

Sanity: above the head pivot (1.36, at the neck), below the hair top (2.087),
0.7153 of `KID_HEIGHT`.

Wired so it cannot drift: `pnpm run measure:kid-landmarks` prints it beside the
rig's own measurement, and `check:character-parity` asserts it. **Proved red** —
1.5164 → 1.5364 gives *"KID_EYE_HEIGHT says 1.5364 m but the painted eye centre
is at 1.5164 m on the built rig"*, exit 1.

## 2. The survey — three of four are NOT this quantity

This is the part that matters. Making them all read the owner would have created
a worse duplicate than the one that existed.

| constant | what it actually is | verdict |
|---|---|---|
| `faces.ts` `eyeY` (0.43 kid, 0.44 ferris friends + dodgems tree) | a fraction of the face **canvas** — not a height, not in metres | **different quantity, untouched** |
| `spookyHouse/face.ts` `EYE_Y = 0.55` | model-local offset for a **monster's eye stalks**, beside `EYE_X 0.95`, `EYE_Z 1.42` | **different quantity, untouched** |
| `ferrisWheel/gondola.ts` `PASSENGER_EYE_Y = 1.1` | a **seated** passenger's eyes above the seat | **the one real duplicate** — see below |
| — | standing eyes above the feet | **new: `KID_EYE_HEIGHT`** |

`PASSENGER_EYE_Y` is the same underlying quantity hand-approximated:
`KID_EYE_HEIGHT - KID_HIP_HEIGHT` = 1.5164 − 0.36 = **1.156** against its 1.1.
Its own comment says "near enough for aiming", and it does exactly that — it
aims a passenger's gaze. **Correcting it moves something a child can see**, so
it belongs in its own visible change rather than smuggled into an invisible
one. Worth a ticket; not taken here.

## 3. The arrival-camera lineage analysis (for whoever takes the shot)

**Question asked:** the arrival camera exists on `feat/bus-arrival-camera`
(PR #491) and again on `feat/sphere-combined` — which copy needs fixing?

**Answer: there are not two copies.** `feat/bus-arrival-camera` is a **direct
ancestor** of `feat/sphere-combined` (`git merge-base --is-ancestor` confirms),
and every one of its commit subjects is present in the sphere branch. Sphere
did not re-implement the shot alongside #491 — it *contains* it and re-derived
the geometry on top, against the curved road.

Supporting facts, all measured at the time:

- **Neither is on `main`.** `main` has only the zoom/focus hooks
  (`arrivalCameraZoom`, `CAMERA_VIEW_HEIGHT`); the positioning work — 134 lines
  in `IsoCamera.ts` on #491, 259 on sphere — is unmerged on both.
- `main` **does** have `arrivalSightline.ts` but **not**
  `check-arrival-camera.mts`, so parts of the sphere work have landed
  piecemeal. That is how a genuine second copy would begin.
- `feat/bus-arrival-camera` is **24 commits behind** `main`;
  `feat/sphere-combined` is **1**.
- **Both still have the dive Jim complained about.** #491's own handoff head
  says *"the stand-back dive breaks its framing"*; sphere has
  `arrivalDiveSeconds()` and
  `lerp(arrivalDoorDistance(), ARRIVAL_ARCH_DISTANCE, dive)`.

**Decision taken by the Overseer on this analysis:** fix once on
`feat/sphere-combined` and supersede #491. Merging a 24-commit-stale ancestor
whose descendant has already re-derived its geometry buys nothing, and shipping
#491 would ship the exact defect Jim reported.

## 4. The void-sampling instrument, and its control caveat

`scripts/check-arrival-camera.mts` on **`feat/bus-arrival-camera`** (it is *not*
on `main`). It samples rendered pixels for the void beneath the horizon and
produced the 27.4% → 0.00% figures.

**Run its control first.** Its first version returned a confident **"0.00% on
every frame"** that meant nothing: a foreground bush drew to the bottom edge of
the frame, so there was no void to find wherever the camera was pointed. A
clean zero from this instrument is only evidence once the control has shown it
can report a non-zero.

## 5. Jim's two asks, for whoever writes the shot

Recorded on #491:

> *"arrival camera — it should START facing the bus, not transition down to
> there. Then, the camera should be at eye-height, not overlapping into the
> floor"*

1. Already looking at the bus on frame one — no descent into the subject.
2. Eye height, out of the floor. **`KID_EYE_HEIGHT` is the owner**; note it
   describes where eyes *are*, not where a camera must sit — a camera avoiding
   the floor needs this plus whatever its own near plane demands, and that sum
   belongs to the camera, not here.

## State

- [x] Owner created, measured off the built rig, documented
- [x] `measure:kid-landmarks` prints it; `check:character-parity` asserts it
- [x] Assertion proved red
- [x] Survey done — three of four deliberately untouched, with reasons
- [ ] Gates: `check`, `test:procgen`, `check:coplanar`, `check:swept-bus`,
      `check:park-pool`, `build`
- [ ] PR
