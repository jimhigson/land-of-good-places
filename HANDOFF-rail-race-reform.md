# HANDOFF — rail-race-reform (branch `rail-race-reform`)

Worktree: `/Users/jim/dev/landOfGoodPlaces/.claude/worktrees/rail-race-reform`
(NOT the shared checkout.)

## The brief, verbatim from Jim

> Rail race game reformed. It should now be a side-on perspective like before,
> with 4 parallel tracks. The tracks should go around the perimeter of the park,
> so that the side-on perspective is looking into the park. It shouldn't
> otherwise turn left or right but should undulate up and down with each of the
> four tracks going up and down independently. There should be obstacles to duck
> under by releasing the press, and also black parts of the track where you need
> to let go otherwise the tracks start to spark. The track rendering to 3d
> objects should use our standard track path following. The ride is a 4-way race.

## Investigation findings (do not re-derive these)

### 1. Which of the two implementations is live

**`src/world/coaster/Coaster.ts` with `options.race` is LIVE.**
`MiniGameHost.checkStalls` (line 217) calls `boardRide(stall.id)` *before*
`begin(stall)`, and `Game.ts:461` routes `'railRacer'` →
`world.raceCoaster.requestBoard()`, which returns true. So the stall never
reaches `StallDefinition.create`.

**`src/minigames/railRacer/` is DEAD CODE** reachable only through that unused
`create`. `MiniGameHost`'s own comment says so out loud: *"The 2D rail racer
scene is retired; its stall (and the Sky Cruiser's) stay as the ways in."*

But it is dead code that is **exactly what Jim means by "like before"**:
- `course.ts` `LANES = [-4.8, -1.6, 1.6, 4.8]` — four parallel rails already,
  "far to near", player on the nearest.
- Already a 4-way race: player + `RIVALS` = Pip, Nell, Otto.
- Side-on ortho camera, `CAMERA_YAW 0.17` / `CAMERA_PITCH 0.3` — just enough
  pitch to stack four lanes into four rows of the picture.
- Hold-to-accelerate, release-to-duck, with the amber→mint lamp language that
  teaches the rule without words.

So the reform is: **take the retired 2D game's shape and rebuild it on real
in-park rails around the perimeter**, replacing the `Coaster` race mode.

### 2. `buildTrack` is NOT reusable as-is for this

`src/world/train/track.ts` `buildTrack(route)` drapes everything on
`terrainHeight` (sleepers, ballast, `railCurve` all sample it). Our lanes carry
their **own** elevation and undulate independently, so a terrain-draped builder
is the wrong shared utility.

The real shared idiom for elevated rail is `Coaster.buildTrack`'s **swept
tube**: sample the route, offset sideways by the horizontal normal
(`sideX = tangent.z, sideZ = -tangent.x`), build a `CatmullRomCurve3`, then one
`TubeGeometry` per rail. Circular cross-section is why a plain `TubeGeometry`
works — Frenet-frame twist is invisible on a round tube.

### 3. Camera facing — the trap, and why this ride sidesteps it

Everything in the park is modelled facing **+Z**; a three.js `PerspectiveCamera`
looks down its own local **−Z**. So a camera bolted into a seat rotated by
`atan2(tangent.x, tangent.z)` faces *backwards* — measured at
`dot(cameraForward, travel) = -1.000`. `Coaster` fixes it with `eyeMount`, a
child of `cartMount` turned π.

**This ride does not mount its camera on the cart at all.** Side-on means the
view direction is the horizontal *inward* normal, not the tangent, so the camera
is positioned in world space and `lookAt`s an aim point each frame. There is no
seat rotation to get backwards. Verified numerically, not assumed — see the
probe script.

`npm run check:ride-camera` only drives `SpaceFerrisWheel`, so this ride cannot
move that hash as long as `core/RideCamera.ts` is untouched.

### 4. The "duck bars invisible/ineffective — holding wins" bug

Root cause in `Coaster.updateRace` (lines 419–427), two independent faults:

- **The bonk barely costs anything.** A bonk sets `speed = max(2.5, speed*0.35)`
  but the speed lerp back to target is `(target-speed) * min(1, 3.2*dt)` — a
  ~0.31 s time constant. You are back to full pace in under a second. Compare
  the retired 2D game, which tuned `BONK_SPEED_FACTOR = 0.35` *plus* a 1.3 s
  wobble during which thrust does nothing, explicitly because "a bonk must cost
  *more* than the coasting it saved, or holding the button down for a minute
  would be the winning strategy and the game would have nothing to teach."
  `Coaster`'s `bonkWobble` decays but **never gates thrust** — nothing reads it
  except a seat wobble. So holding wins.
- **The hit window is frame-rate dependent.** `gap < 0.9` is a 1.8 m window;
  at `MAX_SPEED*0.9 = 13.5 m/s` a 30 fps frame steps 0.45 m and a hitch steps
  straight over it. It samples position instead of testing the swept interval.

Both are designed out of the rebuild: thrust is gated while wobbling, and hazard
crossing is tested as **interval overlap** (did `[prev, now]` cross the bar),
which cannot be stepped over at any frame rate. Verified numerically.

## Status

- [x] Investigation
- [ ] Perimeter route + 4 undulating lanes
- [ ] Rail geometry
- [ ] Race logic + hazards
- [ ] Side-on camera
- [ ] Numeric probe script
- [ ] PR
