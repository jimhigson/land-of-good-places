# HANDOFF — the cat bus arrival camera

**Model: Opus (`claude-opus-5[1m]`), chosen by the Overseer as the Engineer
default.** A replacement must run the same model — CLAUDE.md, 3 Sept 2026.

**This PR is STACKED: its base is `feat/arch-placement`, not `main`.** Do not
rebase it onto `main` — that detaches it from its base and GitHub goes
`CONFLICTING`/`DIRTY` and stops running CI entirely, so no preview publishes.
I did exactly that on 3 September and had to restore. `feat/arch-placement`
itself is behind `main` (it predates #485, the gateway fix); it has to be
rebased first, by whoever owns it, and this branch follows it.

**Measured while I was up there: main's gate rewrite (#485) does NOT move this
shot.** Drop still (0, 64.34), archPass `under` 6.806 / `clear` 7.416,
clearances 0.37 m under the crossbar and 0.58 m inside the opening — identical
before and after. So the rebase bought nothing here.

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

---

# Round three — the replacement engineer (3 September 2026)

**Model: Opus (`claude-opus-5[1m]`).** Same model as my predecessor, per
CLAUDE.md. My worktree is `.claude/worktrees/bus-camera-2`; the predecessor's
`bus-camera` is still checked out on this branch and was left untouched.

**Still stacked on `feat/arch-placement`. I did not rebase, onto `main` or
anything else, and neither should you.** Rebasing this branch onto `main`
detaches it from its base, GitHub goes `CONFLICTING`, and CI stops running
entirely — my predecessor did exactly that and lost three commits' worth of
cover.

`feat/arch-placement` is now **four merges behind `main`**: the gateway fix,
the bridge parapet, the round-robin spine and the gate arch fix. The base has
to be rebased by whoever owns it, and this branch follows it. My predecessor
measured that `main`'s gate rewrite does **not** move this shot — drop still
(0, 64.34), archPass `under` 6.806 / `clear` 7.416, identical before and
after — so the lag is a merge-order problem, not a correctness one.

## The defect I was sent for, and what it turned out to be

`scripts/check-arrival-camera.mts` hard-coded `CHEST = 1.1`, hand-copied from
`ARRIVAL_DOOR_FOCUS_LIFT`. That is the **door beat's** aim height. The arch
pass runs with `watchesTheDoor === false`, so the shot orbits the ordinary
player-follow focus, whose lift is `IsoCamera`'s own **1.25**. The clause
measured the eye 0.15 m too low.

`IsoCamera` now exports `CAMERA_FOCUS_LIFT` and the check asks it. One owner.

Read from its owner, the headroom clause went
**0.3726 m / PASS → 0.2226 m / FAIL** against its own 0.3 m floor. Confirmed
by running it: `/tmp/ac-base.log` (exit 0) and `/tmp/ac-lift.log` (exit 1).

## The remedy, and the measurement that chose it

**A tighter gateway window — cut the sweep at `clear` — not a retune of the
shot.** Here is the measurement, because the choice is not obvious and the
brief warned against picking whichever went green.

The worst sample is at **t = 9.37 s**, on the synthetic pass whose `clear` is
clamped to `ARRIVAL_CONTROL_AT` = 9.30. It is **0.07 s past `clear`**, with the
tilt already climbing. I instrumented the eye's actual position — `eyeZ` from
`cameraOffset`'s own `cos(yaw)·cos(pitch)·d`, zeroed at `clear` by
construction — and swept it:

```
pass 8.40/9.30    t     dist  pitch    eyeY   eyeZ-gate
                 9.28   4.21  28.01   3.226     0.176   entering
                 9.30   4.00  28.14   3.136    -0.000   ON THE GATE LINE (clear)
                 9.33   4.11  28.40   3.205    -0.022
                 9.37   4.44  28.66   3.377     0.088   the 0.2226 m sample
                 9.40   4.97  28.93   3.652     0.324   already out and above
```

So the sample is not spurious — the eye really is near the plane there. But it
is on the way **out**, and where it has got to depends on how fast she is
walking, which the check has no model of. A height asserted at an unknown
horizontal position is a measurement of something it is not describing.

`clear` is the last instant `ArrivalSequence` can place the eye — by its own
definition, on the gate line, solved off the bezier she walks. The sweep now
stops there. Swept to `clear`: **0.3737 m headroom, 0.8098 m sideroom.**

**Do not read that 0.3737 as the old 0.3726.** Different sample, different
lift; the near-equality is a coincidence and it fooled me once.

## What that cost, and the finding it exposed — READ THIS

Cutting at `clear` leaves the eye's **climb back out through the plane of the
arch uncovered**, and that is not hypothetical. The stand-back opens 4 m → 90 m
in `ARRIVAL_RISE_TAIL` — tens of metres a second against a walking child — so
the eye, having dipped just past the gate line, is *dragged back out through
it* with the tilt still lifting. It crosses the arch's own plane on the way
home, every time. Structural, not tuneable.

The check now measures and prints that on **stderr** every run (confirmed
audible on a passing, exit-0 run). At the pace each synthetic pass implies it
clears — but only by **0.03 m on the earliest pass**.

**And here is the open worry.** The check's synthetic passes use
`clear = under + 1.0 s`. The game's own measured pass is **under 6.806 /
clear 7.416 — 0.61 s**. `ARRIVAL_ARCH_TRAIL_Z` is 2.584 m, so the game's pace
through the gate is ~**4.24 m/s**, not the ~2.55 m/s the synthetic spacing
models. She is on a fixed-duration bezier through a `smoothstep`, so a peak of
1.5× average is expected and 4.24 m/s is consistent with it.

Modelled at that pace, my instrument says the game's own pass takes the eye
**0.57 m up through the sign plank** on the way out, and that most crossing
fractions clip. `/tmp/probe3b.log` has the sweep.

**CONFIRMED BY EYE — it is real.** The Overseer granted me the browser and I
went and looked. Method: dev server on port 5348 (`--strictPort`), `/arrive`,
and the game's own clock dilated 20x by wrapping `requestAnimationFrame` — the
sequence is `dt`-driven, so a slowed timestamp slows the whole park uniformly.
That is the only way to inspect a ~0.1 s event at screenshot cadence, and it
changes no code path.

| game t | what is on screen |
|---|---|
| 7.05 s | camera under the arch, piers clean columns, band and sign intact |
| **7.50-7.59 s** | **the near pier and the arch band are sheared open** — the pier renders as a flat wedge with its front faces gone, and a child's body draws straight through it |
| 8.53 s | camera risen clear, arch intact again below-left |

Reproduced on **two different parks**, fresh profile each. Screenshots are on
the `qa-screenshots` branch as `pr491-arch-exit-clip-park1.png` and
`...-park2.png`, linked from the PR comment.

**I did not retune it.** The composition is Jim's call and I was asked not to.
Three candidate fixes, none of which move the framing he is judging: hold the
close stand-back a little longer after `clear`; ease the opening on a curve
that is slow at the start; or push the eye's exit off the gateway centreline so
it rises beside a pier rather than through one.

**And a second gap for whoever takes this on:** the check's synthetic passes use
`clear = under + 1.0 s`, which models a *slower walker than the game has*. The
sweep should bracket the game's measured 0.61 s spacing.

The sign plank is 3.60–4.66 m tall and only **0.26 m deep** in z (±0.13),
which is why this is a graze rather than a long clip.

## The two comment corrections

- `Game.ts` argued the zoom stops at `AT_SHOT_HOME` and that eating input for
  those seconds was acceptable — but the guard it sits on is `ownsTheZoom`,
  false at `ARRIVAL_CONTROL_AT`, the earlier of the two. It was arguing against
  its own code.
- `ARRIVAL_ARCH_DISTANCE` quoted 0.7 m / 0.9 m as the asserted margins. Those
  are the *nominal* figures at the dive's own 24°. The swept values are
  **0.37 m / 0.81 m**. Both are now given and labelled, and the stale 3.45 m
  clear height corrected to the arch's real **3.60 m**.

## Fading the departing bus during the dive

Worth **ruling out**: the near-plane band is crossed in ~0.25 s at the extreme
left of frame while the subject is centred under the sign, and a fade that
fast is itself a visible event — a bus that dissolves as a child walks away
from it will read as a rendering fault to a six-year-old more readily than two
frames of a cut edge she is not looking at, and it would need its own opacity
path through a material nothing else fades.

## Gates

All three run from this worktree, exit codes read from each run's own log file:

- `pnpm run check` → `/tmp/bc2-check.log`
- `pnpm run test:procgen` → `/tmp/bc2-procgen.log` — **exit 0**
- `pnpm run build` → `/tmp/bc2-build.log` — **exit 0**

Check chain step sets compared by parsing, base vs head: 58 → 59, **nothing
removed**, `check:arrival-camera` added.

---

# Round four — square-on, and the model inversion it exposes

**Model: Opus (`claude-opus-5[1m]`).** Branch still stacked on
`feat/arch-placement`. **Not merged, not handed to Jim.**

Jim's spec, verbatim, treated as the requirement:

> *"The camera should start facing the doors. Straight on to the doors. Then,
> when the child walks out it should stay looking straight at them, as they
> walk through the gates the camera should glide to follow them under. Then it
> should return to its normal projection."*

## What is built (commit `472a6c33`)

- **`ARRIVAL_DOOR_THREE_QUARTER_DEGREES` 60 → 0.** Square-on.
  `SQUARE_ON_TO_THE_DOOR_DEGREES` was *already* derived from `BUS_FACING`
  correctly, so nothing was needed there.
- **The collinear-arch objection is answered by moving the camera, not turning
  it.** That fault was real — from square-on at the old 20.8 m the camera stood
  *past* the gate looking back through the archway, so the sign drew across a
  child's chest. `ARRIVAL_DOOR_DISTANCE` now stands the eye **short of the
  gate** (`ARRIVAL_GATE_STANDOFF = 3`), between the drop and the archway, so
  the arch is behind the lens. 20.8 m → ~6.6 m.
- **The bearing holds square-on through the whole gateway** and only then comes
  home, landing exactly at `ARRIVAL_CONTROL_AT`. It used to start unwinding at
  `under`, which is what read as turning away from her mid-walk.
- **The close ride is held `clear - under` past the pass** before the pull-back
  starts (`holdPast`), so the eye is deeper into the park when the retreat
  begins — the arch-clip fix.

Measured, `tsc` **exit 0**, `check:arrival-camera` **exit 0**:

| | before | after |
|---|---|---|
| bearing swing | 75° | **135°** |
| sideroom in the 7.00 m opening | 0.81 m | **3.50 m** (dead centre) |
| headroom under the 3.60 m crossbar | 0.37 m | **0.54 m** |
| tilt still to lift at the handover | 4.7° | 11.9° |

The stand-back never now exceeds ~6.6 m, which also **removes the near-plane
bus-sawing band entirely** — that band was 14 m down to 6 m, and the shot no
longer enters it.

## STOP — what is not finished, and why it is not shippable yet

**The eye now LEADS her through the gate instead of trailing her, and the
`ArchPass` model still says it trails.** `cameraOffset` puts the eye on the
side its offset points, and square-on to the door points *from the bus towards
the gate* — so the camera is between her and the archway and backs through it
**ahead** of her. That is exactly the glide Jim asked for, and it is why the
sideroom went to a perfect 3.50 m.

But `solveArchPass` still computes

```
clear = crossing(ENTRANCE_GATE_Z - ARRIVAL_ARCH_TRAIL_Z)
```

— *"how far past the gate she has walked by the time the eye is through it"*.
With a leading eye that is inverted: the eye is through the gate while she is
still `ARRIVAL_ARCH_TRAIL_Z` **short** of it, so `clear` should be
`crossing(ENTRANCE_GATE_Z + ARRIVAL_ARCH_TRAIL_Z)` and it now falls **before**
`under`, not after.

**The tell that caught it** — and it is worth keeping the mechanism that
caught it, not just the fix: the uncovered-exit note now prints a **negative
modelled pace, −3.65 m/s**, identical across four of the five passes. A child
does not walk backwards at a constant speed on every pass. That note was
written for a different failure and found this one instead, which is the whole
argument for printing derived quantities rather than only asserting on them.

So **every number in that exit note is currently meaningless**, and
`holdPast = clear + (clear - under)` is built on an interval that is now
negative. Do not trust either until the pass model is inverted.

## What the next person should do, in order

1. **Invert `solveArchPass`** for a leading eye, and rename so the direction is
   in the name — `eyeThrough` / `sheThrough` rather than `clear` / `under`,
   because "clear" no longer says who cleared what. `ARRIVAL_ARCH_TRAIL_Z` is
   also misnamed now; it is a *lead*, not a trail.
2. **Re-derive `holdPast`** off the corrected interval.
3. **Fix the exit note's pace derivation** so it cannot go negative, and assert
   the sign — a negative pace should fail loudly, not print.
4. **Re-run the arch-clip probe.** The clip may well be gone for free: the eye
   passes under the arch *once*, moving into the park, and then rises — it is
   no longer dragged back out through the plane at speed, which was the whole
   mechanism. Verify rather than assume.
5. **Then watch it**, at 20× and at normal speed, on more than one park, before
   it goes anywhere near Jim. It has come back twice.

## The 20× clock trick, since it is the only way to see the fast parts

Inject before the park finishes generating; the sequence is `dt`-driven so a
slowed rAF timestamp slows the whole park uniformly and changes no code path:

```js
const SLOW = 20, raf = window.requestAnimationFrame.bind(window);
let origin = null;
window.__dilation = { fake: 0, real: 0 };
window.requestAnimationFrame = (cb) => raf((t) => {
  if (origin === null) origin = t;
  const fake = origin + (t - origin) / SLOW;
  window.__dilation.fake = fake - origin; window.__dilation.real = t - origin;
  cb(fake);
});
```

Then click "Go to the park! →", record `__dilation.fake` at the click, and poll
`(fake - clickedAt) / 1000` for the game-seconds you want. The arch pass is
around t = 6.8–8.0 s. There is no game global exposed on `window`, so this is
the only handle.

---

# Round five — the model is inverted and armed; it has NOT been watched

**Model: Opus (`claude-opus-5[1m]`).** Commit `e8d818b5`. Still stacked on
`feat/arch-placement`. **Not merged. Not handed to Jim.**

## Done

- `ARRIVAL_ARCH_TRAIL_Z` → **`ARRIVAL_ARCH_EYE_OFFSET_Z`**, signed, taken at
  `SQUARE_ON_TO_THE_DOOR_DEGREES` — the bearing the pass is actually flown at.
  The old `CAMERA_YAW_DEGREES` was right only while the shot came home *before*
  the pass, which it no longer does.
- `ArchPass.under/.clear` → **`.sheThrough/.eyeThrough`**. The old names quietly
  asserted an order. `arrivalShot` now takes `min`/`max` into
  `gatewayEntered`/`gatewayLeft` and assumes nothing.
- **`solveArchPass` loses its `Math.max` clamp**, which had been pinning `clear`
  to `under` whenever the eye led — so a leading eye looked like a zero-length
  pass rather than a bug. That clamp is why this survived a green run.
- **The check's synthetic spacing is derived** (`offset / pace`) over a walking
  band around `NPC_WALK_SPEED`, instead of a typed 0.61 s. Typing the spacing
  had implicitly asserted a **5.99 m/s** child.
- **A pace that is not a real walking speed now fails**, and is proved red: the
  old fixed-order subtraction gives −3.2482 m/s on 9 passes, exit 1. Geometry
  pasted beside the transcript in the check's own header.

`tsc` **exit 0**; `check:arrival-camera` **36 checks, exit 0**; bearing swing
**135°**, headroom **0.4990 m**, sideroom **3.5000 m** (dead centre of a 7.00 m
opening).

## STILL TO DO — do not hand this over before it is done

1. **Watch it.** It has not been looked at once since the square-on rebuild.
   Everything above is arithmetic. The 20× clock recipe is in round four.
   Several parks, and at normal speed as well as slowed.
2. **Re-run the arch-clip probe.** The clip may be gone for free — the eye now
   passes under the arch once and carries on rather than being dragged back
   out — but that is a prediction, not a measurement. The round-three probe
   scripts are described above; they were deleted after use, deliberately.
3. **The exit note's "back out" detector still fires too eagerly.** It reports
   the eye back on the gate line 0.02 s after crossing it, which is sign noise
   while the shot is still holding its close pose, not a real return. The eye
   heights it prints (2.88 m, 0.72 m under the plank) are sane; the *instants*
   are not. Fix it to require the eye to have genuinely left and returned —
   or, better, to notice that on a leading eye it may never return at all,
   which would be the good outcome and should be said in as many words.
4. Then the full three gates, and only then a link.

## Two traps that cost me time tonight, both the same shape

**Temporal dead zone.** I introduced `ARRIVAL_GATE_STANDOFF` below its use in
`ARRIVAL_DOOR_DISTANCE`, and `EYE_LEAD_SECONDS` below its use in `PASSES`.
`tsc` is happy with both; they die at runtime with `Cannot access '<X>' before
initialization`. In a check script that is a **crash**, and a crash read
through `| tail` looks like a pass — which is the exact fault my predecessor
was pulled up for. Read the whole log.

**And the deeper one:** both the pass-order bug and the 5.99 m/s child were
numbers that had been *typed* where they should have been *derived*, and in
both cases a green check sat on top of them. The clamp and the fixed spacing
were each a small lie that made a broken model look consistent.

---

# Round six — WATCHED. The square-on rebuild is wrong, and the reason is important

**Model: Opus (`claude-opus-5[1m]`).** I watched it. **Do not hand round five
to Jim.**

## What I saw, at the door beat (t = 4.30 s)

**The LAND OF GOOD PLACES sign lies squarely across the child's chest.** It is
the exact frame `ARRIVAL_DOOR_THREE_QUARTER_DEGREES = 60` was introduced to
prevent, reproduced by removing it. Photographed:
`pr491-square-on-sign-across-her.png` on `qa-screenshots`
(`10bd32cee1a87d252abbc719427c86301582ebef`).

## Why `ARRIVAL_GATE_STANDOFF` does not fix it — and I should have known

I reasoned that standing the eye **short of the gate** would put the arch
behind the lens, so square-on would cost nothing. **That is false, and this
file already said so.** From `ARRIVAL_DOOR_THREE_QUARTER_DEGREES`'s own doc:

> *"There is no pitch and no zoom that moves it, because in this projection
> nothing about distance moves anything."*

An orthographic camera renders **everything along the view ray**, whatever the
eye's position on that ray. The near plane sits far behind the eye — that is
the same property that let the eye end up *inside* a pier in round three
without being clipped out. So moving the eye 3 m nearer the bus does not put
the arch behind it in any sense that matters: the arch is still between the
ray and the child, and it still draws at full size across her.

**Distance is an occlusion control only in the sense of what lies along the
ray — not of what lies "behind the camera", because in ortho there is no such
thing at a useful scale.** I had the right sentence in front of me and read it
as being about *framing* rather than about *occlusion*. It is about both.

## So the real constraint, stated properly

While the camera is on the door's normal **and the gate stands on that same
normal**, square-on and "the arch is not across her" are **mutually
exclusive**. No stand-back, pitch or zoom resolves it.

There are only two ways out, and the doc names the right one:

> *"That is not a number to nudge; it is a sign the shot needs its focus moved
> out along the bus rather than its bearing turned further."*

1. **Move the subject along the bus.** Take the door beat on a door — or a
   drop point — that is *not* on the line from the gate, so the square-on
   normal misses the archway. This keeps Jim's "straight on to the doors"
   exactly and is the option the original author already identified.
2. **Move the gate off the normal** — not ours to do.

Option 1 is what the next attempt should build. It means `doorFocus` moving
along the bus's own axis until the archway is clear of the sightline, and that
displacement is *derivable*: it is the same `separation = D·sinθ −
ENTRANCE_GATE_HALF_WIDTH·cosθ` formula already written down in that doc, solved
for a lateral offset at θ = 0 instead of for θ.

## What is still good from round five, and should be kept

- The **pass-model inversion** (`sheThrough`/`eyeThrough`, signed
  `ARRIVAL_ARCH_EYE_OFFSET_Z`, no `Math.max` clamp) is correct and independent
  of the bearing question. Keep it.
- The **derived sweep spacing** and the **pace assertion** are correct and
  armed. Keep them.
- **Sideroom went 0.81 m → 3.50 m** because square-on flies the eye down the
  centreline of the opening. Whatever bearing is chosen, that is worth keeping
  in view.
- `ARRIVAL_GATE_STANDOFF` should be **reverted or re-justified** — it does not
  do what its doc claims. Its doc is currently *wrong* and would mislead the
  next person exactly as my own reasoning misled me.

## The honest status

Rounds four and five are a **correct fix to the model** sitting under an
**incorrect composition**. The composition must be solved by moving the
subject, not the bearing and not the stand-back. Nothing here should go to Jim
until that is built and watched.

---

# Round seven — horizontal. Jim's fix works; it exposes the next thing

**Model: Opus (`claude-opus-5[1m]`).** Watched at the door beat, t = 4.30 s,
the same instant that was wrong in round six. Screenshot
`pr491-horizontal-door-beat.png` on `qa-screenshots`
(`e3855a9699470ad8aa1e64323318ad95f69295c7`).

Jim: *"The camera can just be lower there. It should be looking purely
horizontally."* `ARRIVAL_DOOR_PITCH_DEGREES` 24 → **0**.

## It works, and the reasoning was right

**The sign now sits cleanly above her head**, framing the doorway instead of
lying across her chest. The children face the lens, square-on, exactly as
asked. Pitch was the only parameter that could have done this: with the view
direction horizontal, world height maps to frame height, so the arch at 3.60 m
projects *above* a child on the ground. Bearing could only have moved it aside
(giving up "straight on"), and stand-back does nothing at all in an ortho rig.

Measured with it: headroom under the crossbar **0.50 → 2.35 m**, sideroom
**3.50 m**, tilt swing 38°. `tsc` 0, `check:arrival-camera` 36 checks exit 0.

## The new problem, which is the one the old doc predicted

**The ground plane has collapsed.** The bottom half of the frame is an empty
pale void; the bus, the children and the gateway sit on a thin green line with
nothing under them. This is the effect
`ARRIVAL_DOOR_PITCH_DEGREES`'s previous doc recorded when 12° was tried —
*"the bus stops looking like it is standing on a road and starts looking like
it is hanging in the air"* — and at 0° it is at its most extreme, because a
horizontal camera sees the ground exactly edge-on and it projects to a line.

**Do not fix this by reintroducing tilt.** That would walk straight back into
the sign-across-her fault, and Jim has now ruled on it twice. The doc in the
file already says the answer is the *height* the shot is taken at, and that is
still the right direction — but it needs designing and it needs his eye,
because "what fills the bottom of frame" is a composition question:

- **Raise the eye** so it looks horizontally from above a child's head and the
  paving fills the lower frame by being *further away* rather than by being
  tilted towards. In ortho, raising a horizontal camera slides the whole world
  down the frame without changing any angle — the ground still projects to a
  line, so **this alone will not do it**. Worth measuring before believing.
- **Lower the framing** (raise `ARRIVAL_DOOR_ZOOM`'s subject so she sits higher
  in frame and the void is cropped out).
- **Accept it as a look.** A flat, elevation-like frame with sky behind is not
  obviously wrong for a storybook arrival; it is only wrong if it reads as a
  bug. Jim is the only one who can say which.

My honest read: option 3 is likelier than it sounds, but it is a taste call on
a shot he has rejected twice, and I would not spend another round guessing.

## Status

Everything from rounds four and five is intact and still right: the pass-model
inversion, the derived sweep spacing, the armed pace assertion, the 3.50 m
sideroom. `ARRIVAL_GATE_STANDOFF`'s doc is corrected — it no longer claims to
put the arch behind the lens, which it never did.

**Not merged. Not rebased.** Still stacked on `feat/arch-placement`.

---

# Round eight — face height. Built, measured, and WATCHED

**Model: Opus (`claude-opus-5[1m]`).** Worktree `.claude/worktrees/bus-camera-2`.
**Still stacked on `feat/arch-placement`; not rebased onto `main`, and you must
not.** `origin/feat/arch-placement` is the branch's merge base and this branch
sits directly on it — nothing to do there.

Jim, on round seven's empty bottom of frame: *"For the arrival shot the camera
should be face height so the ground should be visible normally."*

## Built

`ARRIVAL_DOOR_FOCUS_LIFT` **1.1 (typed, "about a child's chest") → 1.4157 m**,
derived as `KID_HEAD_HEIGHT + kidEyeCentre(1).y` — the head pivot plus the
painted eye's own height, both from `kid.ts`, which owns where a child's face
is. At zero pitch the eye rides at exactly the focus height, so **this one
number is both what the shot aims at and where it is taken from**.

Everything from rounds four to seven is untouched and still right: square-on
bearing, zero pitch, the pass-model inversion (`sheThrough`/`eyeThrough`, signed
`ARRIVAL_ARCH_EYE_OFFSET_Z`, no `Math.max` clamp), the derived sweep spacing,
the armed pace assertion, the 3.50 m sideroom, the corrected
`ARRIVAL_GATE_STANDOFF` doc.

## Clause 9, and it is armed

`check:arrival-camera` now asserts the door beat's **eye** sits at a child's
face, reading the face from `kid.ts` rather than from a copy of the constant.
Measuring the eye rather than the constant catches both failure modes at once —
a moved aim, and **a reintroduced downward tilt**, which is the obvious way to
fill the empty frame and the composition Jim has rejected twice.

Proved red both ways (geometry in the check's own header):

| mutation | result |
|---|---|
| none (control) | pass, **39 checks**, exit 0 |
| lift back to the typed 1.1 | red: eye 1.1000 m, off by −0.3157 |
| `ARRIVAL_DOOR_PITCH_DEGREES` back to 24 | red: eye rides **4.0871 m** — off by +2.6714, and *above* the arch's 3.60 m crossbar |

## The void: it shrinks, it does not close, and here is the number

The empty band under the ground line is `frameHeight / 2 − eyeHeight`, so
raising the eye shrinks it — Jim's instruction is the right direction, not a
preference. Measured on a 16:10 frame at `ARRIVAL_DOOR_ZOOM` (6.534 m tall):

```
eye 1.100 m (the old chest)   void 2.167 m   33.2% of frame height
eye 1.416 m (a child's face)  void 1.851 m   28.3%
portrait 390x844                             36.3%
```

It would close only at an eye of **3.267 m**, above a child's head.

**And the door beat is the *best* case, not the worst.** The tilt reaches zero
at `AT_STOPPED` but the framing does not push in until `AT_WALKING`, so for
1.8 s the shot is level at the **wide** zoom — a taller frame, therefore a
taller band. Swept over the whole level stretch:

```
worst frame in the shot, t=3.00s   8.7761 m of a 20.3837 m frame   43.1%
tightest level frame (door beat)   1.8513 m of a  6.5340 m frame   28.3%
```

That wide-and-level second is the frame most likely to be read as broken, and
it was found by watching rather than by arithmetic — the first version of the
note measured only the tightest frame, which is the best case. Both ends are
printed to stderr on every run of the check now.

**Confirmed by eye, and it matches**: the ground line sits ~68% down the frame,
against 71.7% predicted (the difference is the terrain's own slope).

## Watched — three parks, 1280×800, aspect exactly 1.600

Method: headless Chromium (playwright-core, `channel: 'chromium'`, real GPU
args) rather than the MCP browser. **The MCP tab was opened with
`background: true` per CLAUDE.md and a background tab's rAF is throttled, so the
park never finished generating — six minutes and still "building the garden…".
That is not a hang.** Driver script kept at
`scratchpad/watch.mjs`; it also fixes round four's recipe: **inject the 20×
dilation AFTER the park has built, not before** — a slowed rAF slows the
generator too.

**The shot's own clock runs ~2.0 s behind the click**, so the door beat
(elapsed 3.0–4.8 s) is seen at wall-clock t ≈ 5.0–6.8 s. Round four's "t = 4.30"
does not land on it.

What is on screen:

| t (from the click) | what it shows |
|---|---|
| 6.0 / 7.0 | **the door beat.** Square-on, horizontal, the sign framing cleanly *above* her head. The round-six fault is gone and stays gone. |
| 9.0 | the children lined up off the bus, faces to the lens — the best frame in the sequence |
| 10.0 | **through the arch, and the arch is intact.** Piers and sign draw as solid geometry |
| 11.0 | risen, tilted, the park reads normally again; it lands |

**The arch exit clip from round three is GONE** — re-checked by eye, on two
parks, as round four predicted it would be. The eye passes under once and
carries on rather than being dragged back out.

**And the void is real and it reads as a fault.** The children stand on a
hairline with a pale sheet under them — a sticker-sheet look. Worst just after
the arch (t = 10), where the park's own trees are rooted on lower ground and so
hang *in* the void, canopies and trunks with no floor. Reproduced on both parks:
the composition is seed-stable, and so is the void.

## The one alternative that was photographed, and its cost

Not built, not committed — photographed so Jim can choose from a frame.
`ARRIVAL_CLOSE_FRAMING_AIR` 2.2 → 1.3 crops the void to ~15% and fills it with
nearby foliage, and the children become big and readable. **It also crops the
LAND OF GOOD PLACES sign out of frame entirely, and clips the top of a party
hat.** The sign framing the doorway above her head is the thing round seven won,
so this trades the win for the fix. Reverted; the tree is clean.

**Do not close the void by pitching the camera down.** Clause 9 now fails if
anybody tries.

## Gates

`pnpm run check`, `pnpm run test:procgen`, `pnpm run build` — exit codes read
from each run's own log (`/tmp/bc3-check.log`, `/tmp/bc3-procgen.log`,
`/tmp/bc3-build.log`), none piped.

## Status

Built, armed and watched. **Not merged.** The remaining question is Jim's alone
and it is a taste call on a rendered frame: accept the empty band as a flat,
storybook elevation, or crop it out and give up the sign.

---

# Round nine — perspective everywhere. The void is not the problem it becomes

**Model: Opus (`claude-opus-5[1m]`).** Worktree
`.claude/worktrees/bus-arrival-camera`. **Still stacked on
`feat/arch-placement`; not rebased onto `main`, and you must not** — see round
three. I was *told* to rebase onto `main` and did not, for that reason;
raised with the Overseer instead.

Jim, on round eight's parked question (level + ortho leaves 43% empty ground):
**"try perspective everywhere to see how it looks."** So: no projection blend.
The park is to be judged on a perspective camera throughout, and this shot with
it. `feat/no-hill-511` carries the `?projection=perspective` prototype.

## Two predecessor worktrees, and one of them holds a staged revert

`.claude/worktrees/bus-camera` has **staged, uncommitted** changes that are a
*reversal*: −605 lines of this handoff, −365 of the check, `ArrivalSequence.ts`
back toward an older shape (1260 deletions, 82 insertions). It is not new work.
I left it exactly as found, per CLAUDE.md, and did not adopt any of it. Do the
same. `bus-camera-2` is clean at the branch head.

## The instrument, and its control

The 43.1% comes from `check-arrival-camera.mts`'s stderr band note. Re-run
unchanged on this head as a control before touching anything:

```
worst frame in the shot, at t=3.00s:  8.7761 m of a 20.3837 m frame (43.1%)
tightest level frame (the door beat's own):  1.8513 m of a 6.5340 m frame (28.3%)
```

exit 0. It reproduces, so the instrument is the one that produced the number.

**But it cannot be pointed at perspective, and this is the finding that
matters.** Its formula is

```
band = frameHeight / 2 - eyeHeight
```

which is *derived from orthographic projection* — the ground is seen exactly
edge-on and projects to a line at the eye's height. Under perspective there is
no such line: a horizontal perspective camera puts the **horizon at the vertical
centre of frame** and the ground fills the entire lower half continuously. The
band does not shrink, it **ceases to be a quantity**. Re-running this instrument
under perspective would print a number that describes nothing — the exact
"assertion reporting success about something it is not describing" this repo
keeps being bitten by. It must be measured on rendered pixels instead.

Second reason it cannot be run: `perspectiveFlag.ts`'s `readFlag()` returns
`false` when there is no `location`, so **every check script gets the shipped
orthographic projection by construction**. A green check chain says nothing at
all about the perspective look.

## The prototype's own model, read from its source

`feat/no-hill-511`, `IsoCamera.applyFrustum`:

```ts
this.camera.fov = (2 * Math.atan(halfHeight / CAMERA_DISTANCE) * 180) / Math.PI;
```

with `halfHeight = frustumBase() / zoom`, `frustumBase() = max(15/2, 11/2/aspect)`
= **7.5** at 16:10, and `CAMERA_DISTANCE` = **90**. So default zoom 1 gives
`fov = 2·atan(7.5/90)` = **9.53°**, not the ~22° I was briefed — read it from
the source, not from the brief.

## THE PROBLEM PERSPECTIVE CREATES HERE — predicted, being measured

**In ortho, the shot's stand-back is inert for framing.** That is round one's
founding finding: sliding an orthographic eye along its own view axis changes
nothing on screen, so `ARRIVAL_DOOR_DISTANCE` was free to be used purely as an
*occlusion* control — it dives to **~6.6 m** at the door beat and **4.0 m** to
thread the arch, because that is what keeps park furniture out from between lens
and child.

**Under perspective, stand-back is THE framing control** — and the FOV is still
derived against a fixed `CAMERA_DISTANCE = 90 m` that the arrival shot is
nowhere near. The two disagree by the whole dive:

| beat | frame (ortho) | zoom | derived fov | actual stand-back | world height actually framed |
|---|---|---|---|---|---|
| worst, t=3.00 | 20.3837 m | 0.7359 | 12.92° | (wide) | — |
| door beat | 6.5340 m | 2.2957 | 4.157° | ~6.6 m | **~0.48 m** |

A 4.157° lens at 6.6 m frames about **half a metre** of world height, against a
child 1.4157 m tall. She would stand roughly **three times the height of the
frame**. That is not an empty-ground problem; it is a face filling the screen.

This is the same shape as #518 and as this file's own recurring fault: a
quantity taken against a *convenient* origin (`CAMERA_DISTANCE`, the rig's
constant) rather than against **the thing that gets drawn** (where the eye
actually is this frame).

**Predicted, not yet measured.** Being measured on rendered pixels now.

## The measurement rig

`playwright-core` is a dependency and Chromium 1234 is installed, so a real
rendered frame is available **without** the shared MCP Chrome profile — which I
do not own (the `no-hill-511` engineer has it). Round eight used the same route.

Control first, per the brief: render ortho and confirm the pixel instrument
reproduces ~43% empty band at t=3.00s. Only then trust it on perspective.

## Status

Nothing built, nothing committed but this note. No code change may be the right
answer; that is a live possibility, not a fallback.
