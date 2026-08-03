# Handoff: the ferris wheel in the real park

Jim's brief (3 Aug 2026): the Space Ferris Wheel should use the **normal park**
as its setting rather than a private scene, keep the space effects (sky
darkening and the rest), and gain a `/ferris` deep link.

Worktree: `.claude/worktrees/ferris-in-park`. **Four stacked branches**, each
based on the one above it:

| PR | Branch | Base | State |
| --- | --- | --- | --- |
| 4 | `ferris-route` | `main` | in progress |
| 1 | `sky-follows-camera` | `ferris-route` | not started |
| 2 | `space-super-night` | `sky-follows-camera` | not started |
| 3 | `ferris-world-ride` | `space-super-night` | not started |

Jim asked for `/ferris` (PR 4) first, hence the stack order — it is
independent of the other three and can be reviewed on its own.

## The mistake that cost the first hour — read this first

The initial survey was done against the **shared checkout at
`/Users/jim/dev/landOfGoodPlaces`, which was ~150 commits behind
`origin/main`**. Two conclusions from it were wrong:

- "There is no URL routing in the codebase at all." Wrong. `8261b57` added
  `RIDE_DEEP_LINKS` and `cee8237` added `/view`. Jim said there was precedent
  for the rails ride and he was right.
- The rail racer's files are no longer at `src/minigames/railRacer/` — that
  whole directory is deleted. The ride is `src/world/railRace/`.

**Always survey from a fresh worktree off `origin/main`, never from the shared
checkout.** It is somebody's live tree and its age is unknowable.

## Findings that survive (verified against origin/main)

- The ferris wheel **is still a curtain mini-game**:
  `src/minigames/ferrisWheel/`, `MiniGame` contract, its own `Scene`, its own
  lights. `stalls.ts:143` still has `create: createSpaceFerrisWheel`.
- What you look down at on the climb is **not the park** — it is
  `below.ts`'s 42 m "toy park" diorama, which falls 340 m.
- `Game.render()` skips the park's passes entirely while
  `miniGames.hidesPark`, so a ferris ride currently costs *less* than standing
  in the park. Converting it reverses that; the space show wants a phone check.
- The seam PR 3 plugs into already has three clients — `world.train`,
  `world.coaster` (Sky Cruiser), `world.railRace`: `rideView.camera` →
  `Game.cameraOverride` via `rideCamera()` inside an iris wipe, plus
  `miniGames.boardRide` (`Game.ts:479`).
- **`DayNight.applyLook()` has exactly one seam** — `const look =
  sampleSkyKeys(time)` — below which everything (sky uniforms, star strength,
  sun/moon discs, all four lights, fog) is decided. That single line is where
  PR 2's space blend goes.
- **`Sky` is screen-space** (it must be: the park camera is orthographic), and
  `uSkyOffset` is a pure 2D *translation*. There is no rotation term at all.
- **`uHorizonY` is set to `0.5` at construction and never written by
  anything.** The horizon is nailed to mid-screen.
- **`Game.ts:426` feeds `DayNight` the iso camera's `forward`**, which
  `IsoCamera` solves once in its constructor and never changes — even while a
  ride camera is what is actually drawing. So the sun and moon are pinned
  during every ride today. Fixing that one line is most of PR 1.
- `IsoCamera` cannot rotate (`CAMERA_YAW_DEGREES = 45`, solved once), so PR 1
  is invisible in ordinary play — which is also what makes it safe.

## Decisions taken

- **PR 1 is not ride-specific.** Jim's steer: a first-person walking mode may
  come later, so `Sky` is told *which camera is drawing it* rather than
  "whether a ride is on". Perspective cameras project the sun and moon through
  the real camera matrix; the orthographic path keeps the existing azimuth
  cheat, because parallel rays have no true projection.
- **PR 2 is "space is super night"** — Jim's idea, and it fits: one extra
  `SkyKey` past deep night plus a `setSpaceFactor(0..1)` blend at the seam
  above. Consequences: `nightFactor` → 1 lights the whole park beneath you as
  you climb (a feature, and free); the fog analogy **breaks** (night pulls fog
  *in*, a climb needs it pushed *out*, so `SkyKey` needs near/far fields); the
  screen-space sun and moon must fade out so they do not fight `space.ts`'s 3D
  ones; and the override must never write to the clock or the store.
- **PR 3 keeps the cloud-band curtain.** The park is ~110 m across with a
  boundary wall — from 340 m it would read as an island floating on nothing.
  Clouds close over, the real park is put away, the Earth comes out. The real
  park is visible for exactly the stretch of the climb where it is the point.

## PR 4 — done as of this checkpoint

Two edits in `src/main.ts`, plus the CLAUDE.md paragraph:

- `'/ferris': 'spaceFerrisWheel'` in `RIDE_DEEP_LINKS`.
- `launchGame` now tries `boardRide` and **falls back to
  `miniGames.open(id)`**. The existing table only ever drove world rides; the
  ferris wheel is a mini-game today and a world ride after PR 3, and this is
  what lets one line serve both. PR 3 therefore needs no change here.

**Known limitation, for QA:** the ferris stall is `firstPerson: true`, so
`MiniGameHost.begin()` fires `requestOrientationPermission()`. On a deep link
that is not inside a user gesture, so **iOS will refuse the motion-sensor
prompt** and the ride falls back to dragging to look — which is the documented
graceful path, but it means `/ferris` on an iPad is not a fair test of the
motion controls. Walking up to the kiosk still is.

## Still needs a human

Nothing in this stack has been seen in a browser — this agent does not own the
chrome-devtools profile. Every PR body lists its own visual QA.
