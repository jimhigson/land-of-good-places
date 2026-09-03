# HANDOFF — the cat bus arrival camera

Branch `feat/bus-arrival-camera`, worktree `.claude/worktrees/bus-camera`,
branched from `feat/arch-placement` (which carries the placed gate arch Jim has
already approved). Dev server port **5347** (`vite --port 5347 --strictPort`).

**The URL:** `http://localhost:5347/arrive`

## What Jim asked for

> *"when the bus arrives at the park, the camera needs to face the bus's doors
> as the children get off the bus, then follow your character as they walk into
> the park and under the arch, and then once through the arch the camera moves
> up to its usual pseudo-isometric perspective."*

The previous attempt (on `feat/arch-placement`) changed the **pitch** (38° →
26° → 38°) and the look-at point and nothing else. Jim: *"why doesn't the
camera follow into the park like asked for?"*, *"this is nothing like what I
asked for."*

## The root cause, and it is a property of the rig

**The park camera is orthographic.** Sliding an orthographic eye along its own
view axis changes nothing on screen. So a shot's **yaw**, its **pitch** and the
**point it orbits** are the entire vocabulary of "the camera moved" — and that
attempt held the yaw at the park's one eternal 45° throughout. "The camera
never went anywhere" was a correct description of the frame.

## What is built now

| file | what changed |
|---|---|
| `src/core/IsoCamera.ts` | `setPoseOverride(pitch)` → `setShotOverride(yaw, pitch, distance)`. Still a **delta** from the rig's own `offset`, so the landing is `(0,0,0)` by construction. Pose half-life 0.45 s → **0.12 s** (it is now a smoother, not the animation). |
| `src/world/entrance/ArrivalSequence.ts` | `ArrivalSequence.elapsed` — one continuous `dt`-driven clock. `arrivalShot(elapsed)` — one pure function returning yaw, pitch, zoom, distance and `watchesTheDoor`. |
| `src/Game.ts` | wiring only: drive the shot, clear it once when it lets go. |
| `scripts/check-arrival-camera.mts` | new, in the `check` chain. |

Measured on the running game (`/arrive`, seed 128):

```
t=0.1  bearing  45°  eye (60.6, 57.2, 117.8)  the rig
t=3.3  bearing 120°  eye (17.6, 11.6,  58.2)  the door shot   pose delta 82.9 m
t=6.7  bearing  96°  eye (37.7, 20.2,  57.4)  travelling with her
t=9.4  bearing  45°  eye (50.5, 53.0, 103.1)  she has the controls; still rising
t=12.1 bearing  45°  eye (48.5, 56.5, 101.7)  pose delta 0.00 — the rig exactly
```

Focus over the same span: `(10.4, 67.7)` → `(-1.6, 51.6)`. It translates.

### Three numbers that are derived, not dialled

- **The door bearing.** Square-on to the bus from the park side
  (`atan2` of gate − bus stop), turned 60° down the kerb.
- **The stand-back**, 20.8 m. `(ENTRANCE_BUS_STOP_Z − ENTRANCE_GATE_Z +
  ENTRANCE_CLEAR_RADIUS) / cos(pitch)`.
- **`ARRIVAL_RISE_TAIL`**, clamped to `ARRIVAL_TIMELINE.departing`.

### Two findings that cost the three rejected compositions

Both are properties of the orthographic projection, and neither is visible from
the code:

1. **Stand-back is an occlusion control, not a framing one.** Ortho has no size
   falloff, so pulling the eye in makes nothing bigger — it only changes *what
   can get between the lens and the subject*. The door faces **into** the park,
   so any bearing that faces it looks down the length of the park; at the rig's
   90 m that meant the rail race's track and pylons on one bearing and a hotel
   tower straight through the middle on another. It is different furniture on
   every seed, so nothing tuneable fixes it. Standing in the gateway does.
2. **Square-on puts the arch *on* the door.** Ortho projects anything on the
   view axis to the same screen point, so with gate, door and lens collinear
   the LAND OF GOOD PLACES sign draws itself across a child's chest — at any
   pitch and any zoom. Photographed. 60° down the kerb puts the arch 3 m off
   the sightline, where it frames instead.

And: **12° was tried and is too low.** An ortho camera that flat collapses the
ground plane, so the bus reads as hanging in the air above the boundary wall.

### The one design decision worth re-reading before changing anything

**Yaw and zoom are home *exactly* at `ARRIVAL_CONTROL_AT`; only the tilt keeps
rising (for `ARRIVAL_RISE_TAIL` = 1.6 s).** `IsoCamera.forward`/`right` — the
axes "up on the stick" is read through — are solved once from the rig's fixed
yaw and never move, so a camera still swinging under her hand would mean
pressing up sends her somewhere that is not up the screen. That is
GAME_DESIGN.md's CONTROL rule, and clause 2 of the check is the only thing
standing between it and somebody lengthening the swing later. A tilt still
lifting has no such problem: "up the screen" is the same ground direction at
every tilt.

## Round two — Jim played it and asked for two things

> *"as the child gets out of the bus I want the camera much closer to them, and
> then the camera to follow them as they go under the arch"* — and the
> clarification, *"ie, the camera goes under the arch as well."*

**A bug this found first.** `Game.tick` had **two writers** of `IsoCamera`'s
single focus override: the arrival's door beat, and the keychain rack's picker,
whose branch ends in an unconditional `clearFocusOverride()` for "my picker is
shut". That ran *after* the arrival's write and threw it away every frame.
Measured on the running game: through the whole door beat the camera orbited the
**player** at z 67.70 while `doorFocus` sat at z **64.34**. The shot Jim watched
was never the shot the code described. Both now claim into one value, written
once, below both of them.

| change | before | after |
|---|---|---|
| door framing | `CAT_BUS_TOP` — the whole vehicle | `TALLEST_CHILD_HEIGHT`; she fills **45%** of frame height |
| stand-back at the arch | 20.8 m, outside the gateway | dives to **4.0 m** and passes *through* the opening |
| `SQUARE_ON_TO_THE_DOOR` | the gate→stop line | `BUS_FACING` — the bus's own facing |

**The camera now physically goes through the arch**, and its path has to fit a
real hole. Bounded by the arch's own published clearances, both asserted:
**0.62 m** under the 3.60 m crossbar, **0.92 m** inside the 7.00 m opening.

The two instants are solved off the very bezier `walkIn` walks — she is under
the arch **44%** of the way through the walk, so a camera timed to the phase
would have pulled away long before she got there.

### The one blemish, measured rather than hidden

There is a band of stand-backs, roughly **14 m down to 6 m**, in which the
orthographic near plane lies along the length of the parked bus and saws it open
down the left of frame. Photographed at 20.7 m (clean), 10.5 m (a wedge of
cut-open bus), 5.6 m (clean again, bus gone from frame).

**It cannot be removed.** The eye must finish between the bus and the park to be
a few metres behind her, and the sideroom limit at the arch forces the final
stand-back *below* the band's floor — so the dive crosses it whatever it does.
It is crossed quickly instead: the dive is a quarter of the camera's own lag,
**~0.25 s**, and `smoothstep` is fastest in the middle of its range, which is
where the band sits. What survives is a few frames of a cut edge at the extreme
left while the subject is centred under the sign.

## Watched, as a player

Five parks, end to end, at 960×600 through a real-GPU headless Chromium:
drawn seeds **128** and **11** (both fresh profiles), plus **288**, **451** and
two earlier drawn ones. Frames in `/tmp/w1`, `/tmp/w2`.

The composition is seed-stable *because* the stand-back is derived from
`ENTRANCE_CLEAR_RADIUS` — the seed-variable park is behind the lens. The rail
race crosses the top of the wide roll-in shot on some seeds and not others; it
never crosses the children.

## Open, for Jim — do not change it unasked

The door beat is **1.8 s** (`doorsOpening` 0.8 + `steppingDown` 1.0). She is
first off, so that is all the time there is before she starts walking; the
other eleven children are still on the step when the camera leaves. Lengthening
`ARRIVAL_TIMELINE` makes a six-year-old wait longer before she can play. He has
been asked and has not answered.

## Deep links

`/arrive` forces the sequence on any profile (fresh or returning) — confirmed
on fresh profiles above. `/spawn`, `/view` and every `RIDE_DEEP_LINKS` entry
still opt **out** of the bus: `launchGame` asks the union once and only
`kind === 'arrive'` answers `true`.

## Still to do

- [ ] `pnpm run check` — running, log at `/tmp/check-buscam.log`
- [ ] `pnpm run test:procgen`
- [ ] `pnpm run build`
- [ ] PR (**do not merge**)
