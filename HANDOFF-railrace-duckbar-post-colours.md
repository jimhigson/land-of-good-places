# Rail Race: duck-bar post colours match lane

## Task
Colour Level 3's duck-bar vertical posts to match their own lane's
`LANE_COLOURS` (same colour as that lane's rails/cart/trestle beams),
instead of every post sharing one neutral colour regardless of lane.

## Status: DONE — implemented, build/tests green, visual QA complete, PR opened

## What changed
`src/world/railRace/track.ts`, `buildRailRaceTrack()`:
- Added `postLaneColour` (a reusable `Color`).
- In the per-lane loop that places each bar's two posts (around where
  `posts.setMatrixAt` is called), set `postLaneColour.set(LANE_COLOURS[lane
  % LANE_COLOURS.length]!)` once per lane, then call
  `posts.setColorAt(postIndex, postLaneColour)` for both post instances
  (left/right side) of that lane.
- After the build loop, added `posts.instanceColor!.needsUpdate = true;`
  alongside the existing `mesh.instanceMatrix.needsUpdate` loop.

Approach taken: **per-instance colour on the existing shared
`InstancedMesh`** (option 1 from the brief), not a split into four
per-lane meshes. This exactly mirrors the pattern already used a few
lines below for `sleeves.instanceColor` (the duck-bar alert-warning
colour system) — same mesh, same material, one draw call, only the
per-instance colour differs. `frameMaterial` (a `MeshToonMaterial`) did
**not** need `vertexColors = true` set on it — verified in
`node_modules/three/src/renderers/webgl/WebGLProgram.js` that `USE_COLOR`
is defined in the fragment shader whenever `instancingColor` is present
(line ~737, inside the `prefixFragment` block, independent of
`material.vertexColors`), which is exactly why the existing sleeves
`MeshBasicMaterial` already worked without that flag either.

## Verified so far
- `npm run build` — exit 0 (includes `tsc --noEmit`, `check:park`,
  `check:rail-race`, and everything else bundled into `build`).
- `npm run test:procgen` — 80/80 passed. Not a placement change (only
  colour), so no new invariant was added per CLAUDE.md's rule (that rule
  is for changes to *what gets placed*, not how it's coloured).

## Visual QA — done

Boarded `/rail-race` on a dev server (port 5340), clicked "Level 3", and
teleported the player cart with
`window.game.world.railRace.carts.find(c => c.isPlayer).rider.travelled = 59.2`
(bars sit at `activeSchedule.lap.bars[].at`, e.g. `60.03`, `96.04`, `180.08` —
read via console since `activeSchedule` is TS-private but reachable at
runtime). Screenshot shows several duck-bar structures each with visibly
different post colours (pink, sky-blue, purple/indigo-tinted-blue,
orange/lemon-tinted, mint) matching `LANE_COLOURS` across lanes — not one
shared colour.

Cross-checked at the data level by reading the live
`InstancedMesh('railRace:duck-bar-posts').instanceColor` buffer directly:
first 16 instances (2 bars) were
`[(1,.27,.53), (1,.27,.53), (.24,.58,1), (.24,.58,1), (1,.74,.19), (1,.74,.19), (.21,.77,.53), (.21,.77,.53), …]`
— i.e. pairs of matching posts (a bar's own left/right post) cycling
through exactly the 4 `LANE_COLOURS` values (markerPink, markerSky,
markerLemon, markerMint) in order, repeating every 8 instances (2 sides ×
4 lanes). Confirms the fix is correct both visually and numerically.

### Traps hit while doing this QA (for whoever does this next time)
- Setting `window.game.cameraOverride = null` while boarded breaks the
  ride's own camera: `RailRace`'s `rideView.update()` mutates the *same*
  camera object handed to `cameraOverride` in place, it doesn't
  reassign the reference each frame — null it once and the ride falls
  back to the far-away free-walk camera for the rest of the session
  (looked like a broken/frozen shot until diagnosed). Don't touch
  `cameraOverride` at all if you just want the normal ride view; reload
  the page to recover if you do.
- `window.game.world.dayNight.paused = true` (and `.time = X`) set
  directly do **not** stick — `Game.tick()` re-derives both from
  `gameStore` every frame and silently overwrites a direct set almost
  immediately, exactly the trap CLAUDE.md already documents for
  `setPaused`. `gameStore` isn't exposed on `window`, so there's no
  console workaround; cheapest fix was just setting `dayNight.time = 0.5`
  right before each screenshot (it drifts again immediately after, but
  survives long enough for one screenshot).

## Opened PR
`gh pr create` — see PR for link. Not merged (one review is current
policy per the user's 1 Aug correction; the Overseer merges).

Heads up from the brief: a different agent was concurrently fixing an
unrelated spark-zone rail-colouring bug in this same file. That fix
(`60be892`, "blacken the actual rails in spark zones") was already merged
to `main` as of this branch's base commit — no conflict, diff here is
additive and far from that code (spark stuff is lines ~260-300 and
~565+; this change is lines ~353-435, the duck-bar post loop only).
