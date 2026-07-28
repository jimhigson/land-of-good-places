# HANDOFF — ride-look

Branch `ride-look`, worktree `.claude/worktrees/ride-look`. One PR, three parts,
all first-person ride work.

## The parity gate — read this first

`npm run check:ride-camera` (`scripts/trace-ride-camera.mts`) is the gate on
`core/RideCamera.ts`. Two things about it that are easy to get wrong:

- It asserts **coverage, not a golden hash**. It exits 1 only if some part of
  its scripted sweep did nothing. The `trace=<8 hex>` line it prints is for a
  **human** to compare between two revisions. There is no stored expected value
  anywhere in the repo — the baseline `26a241cc` lives only in prose, in
  `HANDOFF-ride-camera.md` line 17.
- **Baseline on this branch's parent (origin/main, 55b9b4f): `trace=26a241cc`.**
  Confirmed by running it before touching anything. Matches the documented one.

So "regenerate the expected values" = run it before, run it after, and be able
to say why the hash moved. Recorded below at each step.

## Status

- [x] Baseline trace recorded: `26a241cc`
- [x] Part 1 — glass floor and ceiling in the ferris car
- [x] Part 2 — wider pitch limits on the ferris
- [x] Part 3 — device-orientation (gyro) look for all first-person rides
- [x] `npm run build` green, exit code checked
- [ ] PR raised

## Trace log

| after | trace | why it moved |
| --- | --- | --- |
| baseline (55b9b4f) | `26a241cc` | — |
| Part 1 (glass, art only) | `26a241cc` | unchanged, as expected — no camera maths touched |
| Part 2 (pitch limits) | `d1a4bbf0` | **intentional**: `PITCH_MIN` −0.33 → −1.396, `PITCH_MAX` 0.64 → 1.222 |
| Part 3 (sensor look) | `d1a4bbf0` | unchanged — sensor mode is a separate path, no sensor in Node |

Part 2's move is the whole point of Part 2 and is the only deliberate
behaviour change in this PR. Part 3 is built so the trace stays meaningful:
the trace drives the drag/key path, and with no `DeviceOrientationEvent` in
the headless DOM the sensor path is never armed.

## THE ADDENDUM — not done, deliberately. Read before picking this up.

Mid-task the coordinator added: convert the ferris ride to render the **real
World** instead of its own scene, hide the wheel's own structure while riding.
**I did not do this, and I do not think it should be done as part of this PR.**
Three findings, all checkable:

1. **The cited precedent does not exist.** The addendum says to "check how
   DayNight/check:crowd reference `prop.ferrisWheel`". `prop.ferrisWheel` is a
   `root.name` string, set once at `minigames/ferrisWheel/wheelProp.ts:121`.
   Nothing reads it. `grep -rn 'prop\.ferrisWheel' src scripts` returns that
   one assignment and nothing else; `DayNight.ts` contains no "ferris" at all.

2. **It contradicts documented family canon.** The ferris ride is a separate
   `MiniGame` with its own `Scene` **on purpose**. `below.ts` says so in as
   many words: *"The park down there is a toy of a toy. It is not the real
   park — that one is frozen behind the curtain and is far too expensive to be
   a background."* The ride's premise (GAME_DESIGN.md, quoted at the top of
   `SpaceFerrisWheel.ts`) is that at ~30 s the toy park is swapped for the
   **whole Earth** behind a cloud band, and you spend forty seconds in space.
   The real park cannot be underneath you when the Earth is. Likewise the
   skylight exists precisely so you *can* see the wheel — `gondola.ts` calls
   it "the one window that shows you what you are riding" and "that one detail
   is what tells a child what they are riding". Hiding the wheel deletes a
   deliberate, documented decision.

3. **It would gut the gate I was told to keep honest.** `trace-ride-camera.mts`
   builds `createSpaceFerrisWheel()` as a `MiniGame` and drives it for 94 s.
   Convert the ride and the gate has nothing left to trace.

Scope, for whoever costs it: ~2,900 lines across the eight
`minigames/ferrisWheel/*.ts` files, plus the `MiniGameHost` contract
(`hidesPark`, `finish()`, the overlay HUD), plus the space show's lighting and
sky model, plus `check:gondola-sightline`, plus the stall registration. That is
a rewrite of a family-canon ride, not a camera change.

Worth noting the motivation is already met: the child looks down through the
new glass floor and sees the park falling away below them for the first thirty
seconds, then the Earth. That is the ride working as designed.

**This needs the Overseer and the family, not an agent acting alone.** Flagged
in the PR body as an open question.

## What changed

### Part 1 — glass floor and ceiling (`minigames/ferrisWheel/gondola.ts`)

Floor and roof both moved to the car's existing `glass` material (the
established idiom: `toonMaterial(PALETTE.glassTint, { transparent: true,
opacity })`, which auto-sets `depthWrite: false`). Slightly less transparent
than the side windows — a floor you cannot see is a floor a child will not
trust to stand on.

The mint disc rug had to go: a 1.15 m opaque disc in the middle of a glass
floor is exactly the view the family asked for. Replaced with a **ring** of the
same colour at the floor's edge, which keeps the colour note and frames the
glass as a deliberate porthole.

Sightline check (`check:gondola-sightline`) still passes — it reasons about
seat heights and reach, none of which moved.

### Part 2 — wider pitch (`minigames/ferrisWheel/SpaceFerrisWheel.ts`)

`PITCH_MIN` −0.33 rad (−19°) → **−1.396 rad (−80°)**, `PITCH_MAX` 0.64 rad
(37°) → **1.222 rad (70°)**. Only the ferris. The train and the coaster pass
no pitch limits and keep the shared defaults, so they are untouched.

### Part 3 — device-orientation look (`core/deviceOrientationLook.ts`, new)

New sibling module that `RideCamera` uses as a **second input mode**, chosen at
runtime. Desktop and the trace never arm it.

The risky part is the pure function `orientationToYawPitch(alpha, beta, gamma,
screenAngle)` — exported, no DOM, no state — and it is unit-tested headlessly
by `scripts/check-orientation-math.mts` (`npm run check:orientation`, wired
into `npm run build`). 24 cases; see the script.

## Where things are

- `src/core/RideCamera.ts` — shared camera; `pitchMin`/`pitchMax`/`yawLimit` per ride
- `src/core/rideLook.ts` — drag + keys (unchanged)
- `src/core/deviceOrientationLook.ts` — **new**, the gyro path
- `src/minigames/ferrisWheel/gondola.ts` — the car you sit in; glass here
- `src/minigames/ferrisWheel/SpaceFerrisWheel.ts` — ferris limits, ~line 132
- `src/world/train/ParkTrain.ts:525` — train's first-person seat
- `src/world/coaster/Coaster.ts:258` — coaster's two mounts
