# Rail Race: tap-rate speed control + lap-escalating hazards

Branch `rail-race-tap-speed`, off `origin/main` at `e4f2885`. Worktree:
`.claude/worktrees/agent-a2ccc285b4aceab24`.

## The ask (verbatim from Jim, via Overseer)

Replace hold-to-accelerate with tap-rate-driven speed. No hazards at all on
lap 1; black spark track from lap 2; spark track + head-bonk bars from lap 3
(mapped onto the existing `RACE_LAPS` system, "three levels" = three laps,
escalating). Duck becomes its own dedicated HELD control (mobile: drag down
and hold; desktop: hold Down arrow or hold right mouse button). Speed is
driven by discrete presses (mobile: tap; desktop: mash Space or left mouse
click). Character bobs down on each press, up on release. A helpful "tap fast
to win" message at race start. Real `/view` screenshot proving black track is
genuinely black, and bars only render from lap 3.

## Key finding before starting

The duck-bar removal PR #166 the Overseer's brief warned about is **not** in
this history — `git log origin/main` tops out at `e4f2885` ("wheels 20%
bigger"), one *before* any removal. The Blender asset
(`art/blend/duckbar.blend`, `src/art/models/duckBarAsset.ts`,
`src/art/assets/duckbarGlb.ts`) and its wiring into `track.ts` are all present
and working. **No recovery needed** — just re-wire the existing bars for
lap-3-only rendering and re-hook bonk detection to the new duck-hold signal.

## Design decisions

### Physics (`simulate.ts`)

Replaced boolean `holding` with a continuous `boost` value (0..1):

- Each discrete press bumps `boost` by `BOOST_GAIN_PER_PRESS`; it decays
  exponentially every frame (`boost *= exp(-BOOST_DECAY_RATE * dt)`), so
  mashing faster sustains a higher average boost, tapping slowly gives brief
  fading pulses, never tapping gives zero — thrust is `THRUST_MAX * boost`.
- **Ducking suppresses both new boost gain AND thrust output entirely** —
  this is the load-bearing decision. Duck and boost are now separate input
  channels (you *could* hold Down and mash Space at once on a keyboard), so
  without this coupling a keyboard player could hold duck permanently and
  take zero bonks while still going full speed, making bars decoration. This
  restores the exact economic shape the old "let go to be safe" rule had —
  ducking still costs you the thrust the old release did — while being a
  physically separate control, matching "it's awkward to pedal while
  ducked."
- Bonk zeroes `rider.boost` outright (not just gates new gain) for a crisp
  punishment, same spirit as the old `WOBBLE_LOCKOUT` thrust-dead window.
- Spark zones: `sparking = inZone && boost > SPARK_THRESHOLD` — "tapping at
  all" is now "any residual boost from a recent press," which decays away in
  a few tenths of a second if you actually stop, preserving the old
  let-go-and-coast tension.
- `bob` (0..1): set to 1 on every fresh press, decays fast (`BOB_SECONDS`).
  Drives the pump/pedal animation, independent of ducking.

Constants tuned (see `simulate.ts` doc comments) so a sustained ~6 taps/sec
approaches the old terminal speed, ~2 taps/sec gives roughly 60% of that, and
zero taps coasts on drag+hills alone, same as before.

### Hazard escalation (`hazards.ts`)

`planHazards` still builds ONE physical lap's worth of bar/zone positions
(unchanged — same RNG, same trestle-snapping). What changed is which laps'
copies of the schedule (`barCrossings`/`sparkStretches`, the absolute
travelled-distance arrays `stepRider` walks) actually get populated:
`ZONES_FROM_LAP = 2`, `BARS_FROM_LAP = 3`. Lap 1 contributes nothing to
either array. This is per-rider (keyed off each rider's own `travelled`), so
it's automatically correct even if riders are on different laps.

`RACE_LAPS` raised from 2 to 3, superseding the 1 August "two laps" family
verdict — because this is a fresh, explicit, verbatim ask from Jim for three
escalating levels, and because the physics changed completely anyway (the
old tuning notes don't transfer).

### Geometry visibility (`track.ts`)

The ring is one physical structure ridden every lap — hazard geometry can't
physically differ by lap the way the schedule does. Added
`setHazardLap(lap)`, called every frame from `RailRace.animate()` with the
**player's** current lap: toggles `sparkRibbons.visible = lap >= 2` and
`[posts, bars, sleeves].visible = lap >= 3`. Trestle legs/beams/droppers stay
always visible — they carry the rails every lap, not just the duck bars.
Confirmed this doesn't affect `test/procgen/invariants.ts`'s
`duckBarsStandOnRealSupports` — it reads instance matrices straight off the
built meshes, unaffected by `.visible`.

### Input (`core/input/`)

Added two new `GameAction`s: `duck` (bound to `ArrowDown`) and `boost`
(no keyboard binding — Space already produces `jump`, which the ride
already reads). Added raw mouse-button tracking to `InputSystem` (new,
wasn't there before) — NOT routed through the generic action vocabulary for
the boost/duck actions, to avoid a stray click anywhere in the park (e.g. a
paused-menu button) firing a rail-race-only action. Instead:
`InputSystem.isMouseButtonDown(button)` / `mouseButtonJustPressed(button)`,
consumed only by `RailRace`, mirroring the existing `raceHold` escape hatch.
Right-click's context menu is suppressed only while
`InputSystem.setMouseCaptureActive(true)` (set by `RailRace` on
board/dismount), not globally.

### Touch (`RaceHud.ts`)

Rewrote the single "whole-screen pad." Tracks pointers itself: a pointer that
drags down past a threshold before release enters "ducking" (held, cleared
on release); a pointer released quickly without much downward drag counts as
a tap (queued, drained once/frame by `RailRace` via `takeBoostPresses()`).
One finger can't do both at once — same tradeoff duck-vs-boost has everywhere
else.

## CORRECTION (2 August 2026, mid-build)

Jim corrected the brief: it's **"level 3 only," not "lap 3 only."** The lap-based
escalation I built first (`ZONES_FROM_LAP`/`BARS_FROM_LAP`, `track.setHazardLap`,
`RACE_LAPS` raised to 3) was wrong and is being replaced.

**Correct structure:** three separately-selectable levels, chosen once after
boarding, before the countdown. Each level is a fixed hazard composition for
the *whole* race (every lap the same): Level 1 = nothing, Level 2 = spark
zones only, Level 3 = spark zones + duck bars. **Lap count is unrelated —
reverted `RACE_LAPS` back to 2**, its original value; nothing about level
selection requires changing it.

Rework:
- `hazards.ts`: `planHazards(loopLength, laps, level)` — the physical
  bar/zone *positions* stay level-independent (same RNG regardless of
  level); only whether the schedule arrays (`barCrossings`/`sparkStretches`)
  get populated depends on `level >= 2` / `level >= 3`, applied uniformly to
  every lap (not lap-indexed any more).
- `simulate.ts`: `HAZARDS` can no longer be a fixed module constant (level is
  chosen interactively per race). Split into `HAZARD_LAYOUT` (level-independent,
  feeds `track.ts` geometry, built once) and a per-race `HazardSchedule` built
  from the chosen level. `stepRider`/`barIsHere`/`zoneIsHere`/`rivalInput`/
  `strategyInput` now take the active schedule as a parameter instead of
  closing over a global.
- `track.ts`: `setHazardLap(lap)` → `setHazardLevel(level)`, called once when
  a level is chosen (not every frame off lap progress).
- `RailRace.ts`: new `Phase = 'levelSelect'` between boarding and the
  countdown. `requestBoard()` now stops there instead of starting the
  countdown immediately; new `chooseLevel(level)` method (called from the UI)
  builds the schedule for that level, arms `track.setHazardLevel`, and then
  proceeds into the countdown exactly as boarding used to.
- UI: added a `RaceMoment` `'levelSelect'` moment; `RaceHud` shows three
  buttons (Level 1/2/3) with short copy, and the "tap fast to win" hint is
  folded into that same screen (read while deciding, which is a more natural
  moment for it than a fleeting pill during 3-2-1) rather than a separate
  `hint` moment.
- **Assumption, not asked back about**: exact visual presentation of the
  level-select screen (three cards/buttons, shown right after boarding,
  before any camera/countdown work happens) — a reasonable low-risk UI call,
  noted here for review rather than blocking on a round trip.

## Confirmed: bars still genuinely mount on trestle supports

Jim's explicit requirement — a duck bar must sit on its real trestle leg, not
float at an arbitrary position — is satisfied by mechanism already in the
codebase from PR #163, which my level-based rework never touches:
`hazards.ts`'s `snapToTrestleGrid`/`trestleGridIndex` (bar positions snapped
onto the same grid index `track.ts`'s `trestleSpots()` places real supports
on) and `trestleSpots()`'s mandatory-slot wider search (so a bar's slot can't
silently go missing). My changes only touch (a) which level's *schedule*
populates `barCrossings` for physics, and (b) a `.visible` toggle on the
already-correctly-positioned bar/post/sleeve meshes. Verified by grep: both
functions, `mandatoryTrestleIndices`, and the `spot.at`-based placement loop
in `track.ts` are byte-for-byte what they were before this branch. No
recovery from git history was ever needed — see "Key finding before
starting" above.

## Status: done, PR open

All headless verification is green:
- `npx tsc --noEmit` — clean (strict mode, `noUnusedLocals`/`noUnusedParameters` on).
- `npm run build` — real exit code 0, checked without piping through `tail`/`head`.
- `npm run test:procgen` — 80/80 across all 5 seed suites (this exercises a
  real `RailRace` construction via `World`, including the new
  `HAZARD_LAYOUT`/`setHazardLevel` wiring — not just `simulate.ts` in
  isolation).
- `npm run check:rail-race` — rewritten and passing with real margin: playing
  well (28.6s) beats mashing blind through every hazard (52.2s) by 45%;
  sloppy play (37.6s) sits properly between the two; duck bars are worth
  21.5s on their own once spark drag is isolated out; level 1 is verified
  hazard-free and level 2 verified zones-only, both measured against the
  physics directly (a rider that mashes blindly at level 1/2), not trusted
  from `hazards.ts` alone.

**Environment note for whoever picks this up next**: this worktree had no
local `node_modules` — `vite`/`tsc`/`three` resolved via Node's parent-directory
walk-up to the shared checkout's `node_modules`, which is missing `vitest`
entirely, so `test:procgen` failed with `command not found` until I ran
`npm ci` locally in the worktree (safe — only touches this worktree's own
`node_modules`, never the shared checkout). If `test:procgen` mysteriously
can't find `vitest` in a fresh worktree, this is why.

**Visual verification NOT done**: `mcp__chrome-devtools__list_pages` showed
an existing page open at `localhost:5260` — per CLAUDE.md's shared-profile
policy ("if you have not been told you own it, do not use it"), I did not
touch the shared browser. I started my own dev server on port 5299,
confirmed the app boots and serves `/`, `/view`, and `/rail-race` with 200s,
then killed it. **Still needs real eyes before merge**:
- A `/view` screenshot proving the spark-zone plate is genuinely black on
  level 2/3 (the mechanism is unchanged from the already-shipped
  `setSparking`/ink-fill code — only the new `sparkRibbons.visible` toggle is
  untested live).
- Confirming duck bars render only when level 3 is chosen, not levels 1/2.
- The level-select screen's actual look (three buttons + tip text,
  `src/style.css`'s new `.racehud-levels`/`.racehud-level` rules) — a
  reasonable-but-unverified UI call, see the "Assumption" note above.
- The per-press bob animation and the tap-vs-drag-down touch gesture split in
  `RaceHud.ts` — no way to exercise real pointer events headlessly.

PR: see `gh pr list` / the branch `rail-race-tap-speed` on this repo.
